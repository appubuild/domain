"""L1 — the PyAV renderer: composed frames in, one file out.

This is the second adapter behind `ports/render.py`, and it answers the question
the media port cannot: **how do finished frames become a file?** It opens a
container for an `OutputSpec`, encodes what it is given, and publishes the file
only when everything succeeded.

The shape comes from the port, and so do the rules that give the module its
character:

* **A file is only valid after `finish`.** Until then the bytes live in a
  sibling `.part` file and the output path does not exist — or, if it did exist,
  still holds the *previous* export. Aborting removes the partial file rather
  than leaving a truncated one that looks playable (rule 3).
* **Everything discoverable is discovered before the first frame.** A missing
  encoder, a pixel format the encoder cannot write, a DNxHD profile that no
  resolution of this size supports: all of it is found in `open`, by opening a
  throwaway encoder context with the real geometry and options. Finding out at
  minute forty of an export is the most infuriating failure this software could
  offer, and the port says so.
* **Failure is a value; cancellation is a different value.** `write` answers
  `Result`, and once the job is cancelled every later write fails with
  `NS-RENDER-4005` rather than `NS-RENDER-4003`, because the job framework has
  to tell "the user stopped it" from "it broke" (rule 4).

Colour
------
Conversion happens here, at this boundary, and nowhere else (ADR-0007 §6). The
compositor hands over RGB; `swscale` is told the matrix the frame declares and
the matrix the output wants, and the four tags are written to the encoder
context — a file whose tags do not match its pixels is a file that plays with
the wrong colours on every machine that believes them.

One measured limit, recorded rather than papered over: PyAV 18's
`VideoFrame.reformat` takes `src_colorspace` and `dst_colorspace` but no
destination *range*. `swscale` does honour the range the source frame declares,
so the conversion is performed and tagged in the range the output asks for; a
conversion between two different ranges is not something this binding can
express, and belongs to the compositor, which works in RGB.

Capability probing
------------------
`PyAVCapabilityProbe` measures rather than assumes (ADR-0007 §4): encoders are
listed by asking FFmpeg to construct each codec in write mode, and a hardware
family is only reported when one of its encoders could actually be *opened* —
FFmpeg being built with NVENC and a machine having a usable NVIDIA driver are
two different facts, and ADR-0012 §7 exists because they diverge. Probing costs
a few milliseconds for the codec list and a driver initialisation per hardware
family, which is why the answer is cached for the life of the probe and only
re-measured on an explicit `refresh`.

Testing
-------
`tests/infra/test_render_encode.py` writes real files and reads them back with
the decoder: frame counts, rates, colour tags, audio duration, faststart
placement, and the failure paths (a path that cannot be written, an encoder this
build lacks, a spec the encoder rejects, a cancelled render that leaves nothing
behind).
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import threading
from enum import Enum
from fractions import Fraction
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, Literal

import av
import numpy as np

from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.export import (
    _HWACCEL_NAMES,
    HARDWARE_ENCODERS,
    MUXERS,
    AudioCodec,
    AudioEncodeSpec,
    ContainerFormat,
    HardwareAccel,
    OutputSpec,
    RateControlMode,
    RenderStats,
    ToolchainCapabilities,
    VideoCodec,
    VideoEncodeSpec,
)

# `_HWACCEL_NAMES` is the domain's private table of hardware family → the name
# FFmpeg reports.  It is imported rather than restated because
# `ToolchainCapabilities.supports_hardware` is the other reader: a second copy
# would drift, and the symptom would be hardware silently reported as absent.
from nova_studio.domain.media import (
    AudioBuffer,
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
)
from nova_studio.ports.render import RenderErrorCode

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.domain.media import ColourMeta, FrameBuffer
    from nova_studio.ports.clock import MonotonicReading
    from nova_studio.ports.render import CapabilityProbe, RenderTarget

__all__ = [
    "PyAVAudioSink",
    "PyAVCapabilityProbe",
    "PyAVFrameSink",
    "PyAVRenderTarget",
    "PyAVRenderer",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def _unwritable(cause: str, *, path: str = "") -> NovaError:
    return NovaError(
        RenderErrorCode.SINK_UNWRITABLE,
        "the export could not be written here",
        domain=ErrorDomain.RENDER,
        cause=cause,
        details={"path": path} if path else {},
        remedy=(
            "Choose another folder: the one selected either does not exist, is "
            "read-only, or has no room left."
        ),
        retryable=True,
    )


def _encoder_unavailable(cause: str, *, remedy: str | None = None, encoder: str = "") -> NovaError:
    return NovaError(
        RenderErrorCode.ENCODER_UNAVAILABLE,
        "this build cannot encode what the export asks for",
        domain=ErrorDomain.MEDIA,
        cause=cause,
        details={"encoder": encoder} if encoder else {},
        remedy=remedy or "Export with a codec this machine has an encoder for.",
        retryable=False,
    )


def _unsupported_spec(cause: str, **details: object) -> NovaError:
    return NovaError(
        RenderErrorCode.UNSUPPORTED_SPEC,
        "the export asks for a combination that cannot be produced",
        domain=ErrorDomain.RENDER,
        cause=cause,
        details=dict(details),
        remedy="Change the format, codec or resolution and export again.",
        retryable=False,
    )


def _encode_failed(cause: str, **details: object) -> NovaError:
    """Something broke after the file was opened.

    Retryable because the two usual causes — a driver that lost its device and a
    full disk — are both things a user can fix and a job can retry.
    """
    return NovaError(
        RenderErrorCode.ENCODE_FAILED,
        "the export stopped before it finished",
        domain=ErrorDomain.RENDER,
        cause=cause,
        details=dict(details),
        remedy="Check that the destination still has room, then export again.",
        retryable=True,
    )


def _cancelled() -> NovaError:
    return NovaError(
        RenderErrorCode.CANCELLED,
        "the export was stopped",
        domain=ErrorDomain.RENDER,
        remedy="Nothing was written; export again when you are ready.",
        retryable=True,
    )


# ---------------------------------------------------------------------------
# Capability probing
# ---------------------------------------------------------------------------


def _codecs_in_mode(mode: Literal["r", "w"]) -> frozenset[str]:
    """Every codec FFmpeg will construct in `mode` — "w" for writing, "r" for reading.

    `av.codecs_available` is the union of both directions, and asking for a codec
    in a mode it does not support is the only reliable way to tell an encoder
    from a decoder of the same name.
    """
    found: set[str] = set()
    for name in av.codecs_available:
        with contextlib.suppress(Exception):
            av.codec.Codec(name, mode)  # raises for a codec it will not construct
            found.add(name)
    return frozenset(found)


def _opens_as_encoder(name: str) -> bool:
    """Whether an encoder can be opened at all on this machine.

    Presence in the codec list is not the same as working: `h264_nvenc` is
    listed by every build compiled against the NVIDIA headers, and opens only
    where a driver and a device are actually there (ADR-0012 §7).
    """
    try:
        context: Any = av.codec.Codec(name, "w").create()
    except Exception:
        return False
    try:
        with contextlib.suppress(Exception):
            # Video encoders want geometry before they will open; audio encoders
            # want a rate. Setting both is harmless either way.
            context.width = 320
            context.height = 240
            context.pix_fmt = "yuv420p"
            context.sample_rate = 48_000
            context.layout = "stereo"
        context.open()
    except Exception:
        return False
    return True


class PyAVCapabilityProbe:
    """What this machine can encode, measured and then remembered.

    One instance is meant to serve the process. The measurement is done under a
    lock and cached, so forty concurrent exports do not initialise forty CUDA
    contexts, and `refresh=True` — the "re-detect hardware" button — re-measures
    once, whatever else is asking.
    """

    def __init__(self) -> None:
        self._cached: ToolchainCapabilities | None = None
        self._lock = threading.Lock()

    def capabilities(self, *, refresh: bool = False) -> Result[ToolchainCapabilities]:
        with self._lock:
            if self._cached is not None and not refresh:
                return ok(self._cached)
            try:
                measured = _measure()
            except Exception as error:
                return failed(
                    _encoder_unavailable(
                        f"the bundled FFmpeg could not be queried ({error})",
                        encoder="ffmpeg",
                        remedy=(
                            "The FFmpeg build Nova Studio ships with could not be "
                            "started; reinstall the application."
                        ),
                    )
                )
            self._cached = measured
            return ok(measured)


def _measure() -> ToolchainCapabilities:
    """One measurement of the whole toolchain."""
    encoders = _codecs_in_mode("w")
    decoders = _codecs_in_mode("r")
    return ToolchainCapabilities(
        ffmpeg_version=str(av.ffmpeg_version_info),
        encoders=encoders,
        decoders=decoders,
        hwaccels=_proven_hwaccels(encoders),
        filters=frozenset(av.filter.filters_available),
        pixel_formats=_pixel_formats(),
    )


def _pixel_formats() -> frozenset[str]:
    """Every pixel format `swscale` in this build knows the name of."""
    names: Any = getattr(av.video.format, "names", ())
    return frozenset(str(name) for name in names)


def _proven_hwaccels(encoders: frozenset[str]) -> frozenset[str]:
    """The hardware families whose encoders this machine actually opened.

    Reported as FFmpeg's own hwaccel names — the vocabulary
    `ToolchainCapabilities.supports_hardware` maps a `HardwareAccel` to — so that
    a family with no working device answers `False` instead of offering a user a
    checkbox that fails at minute forty.
    """
    proven: set[str] = set()
    for (_codec, family), encoder in HARDWARE_ENCODERS.items():
        if family is HardwareAccel.NONE or encoder not in encoders:
            continue
        name = _HWACCEL_NAMES.get(family, "")
        if name and name not in proven and _opens_as_encoder(encoder):
            proven.add(name)
    return frozenset(proven)


# ---------------------------------------------------------------------------
# Spec → FFmpeg
# ---------------------------------------------------------------------------

#: The frame layouts the domain can hand over, and the FFmpeg pixel format that
#: describes each. The compositor works in RGB, so this is the *source* format of
#: every conversion, never the encoder's.
_SOURCE_FORMATS: Final[dict[int, str]] = {1: "gray", 3: "rgb24", 4: "rgba"}

#: The profile ProRes is written with in lossless mode, by whether the pixels
#: carry alpha. ProRes has no quality number — the profile *is* the quality —
#: and asking for 4444 XQ on a stream without alpha silently promotes it to
#: twelve bits, which is not what the spec asked for and not what the user paid
#: for in disk.
_PRORES_LOSSLESS_PROFILES: Final[dict[bool, str]] = {True: "4444xq", False: "hq"}


def _video_options(spec: VideoEncodeSpec) -> dict[str, str]:
    """The encoder's private options for this spec.

    Measured against the bundled FFmpeg, codec by codec, because the names are
    not portable: x264, x265 and VP9 take `crf`, MPEG-4 has no constant-quality
    mode at all and takes `qscale`, ProRes takes a profile, and VP9 quietly
    treats `crf` as a ceiling under a default bit rate unless the budget is set
    to zero. An option an encoder does not recognise is ignored by FFmpeg, which
    is why a preset can be passed through without a table of which encoder likes
    which spelling.
    """
    options: dict[str, str] = {}
    control = spec.rate_control
    match control.mode:
        case RateControlMode.CRF:
            if spec.codec is VideoCodec.MPEG4:
                options["qscale"] = str(control.crf)
            else:
                options["crf"] = str(control.crf)
                if spec.codec is VideoCodec.VP9:
                    options["b"] = "0"
        case RateControlMode.CBR:
            budget = control.bit_rate or 0
            options["b"] = str(budget)
            options["minrate"] = str(budget)
            options["maxrate"] = str(control.max_bit_rate or budget)
            options["bufsize"] = str(budget * 2)
        case RateControlMode.VBR:
            options["b"] = str(control.bit_rate or 0)
            if control.max_bit_rate:
                options["maxrate"] = str(control.max_bit_rate)
        case RateControlMode.LOSSLESS:
            if spec.codec is VideoCodec.PRORES:
                options["profile"] = _PRORES_LOSSLESS_PROFILES[spec.pixel_format.startswith("yuva")]
    if spec.preset:
        options["preset"] = spec.preset
    if spec.gop_size:
        options["g"] = str(spec.gop_size)
    return options


def _audio_options(spec: AudioEncodeSpec) -> dict[str, str]:
    """The audio encoder's private options.

    Only a bit rate, and only where one means something: PCM is defined by its
    rate and depth, and FLAC is defined by being lossless.
    """
    if not spec.bit_rate or spec.codec in (AudioCodec.PCM_S16LE, AudioCodec.FLAC):
        return {}
    return {"b": str(spec.bit_rate)}


def _colour_tags(colour: ColourMeta) -> dict[str, int]:
    """The four tags an encoder context should carry, skipping the unspecified.

    An unspecified tag is left as FFmpeg's default rather than written as a
    guess: a file tagged BT.709 whose pixels were graded for something else is
    worse than a file that admits it does not know.
    """
    tags: dict[str, int] = {}
    if colour.space is not ColourSpace.UNSPECIFIED:
        tags["colorspace"] = int(colour.space)
    if colour.range is not ColourRange.UNSPECIFIED:
        tags["color_range"] = int(colour.range)
    if colour.primaries is not ColourPrimaries.UNSPECIFIED:
        tags["color_primaries"] = int(colour.primaries)
    if colour.transfer is not ColourTransfer.UNSPECIFIED:
        tags["color_trc"] = int(colour.transfer)
    return tags


def _conversion_range(colour: ColourMeta) -> int:
    """The range to declare on the frame being converted.

    `swscale` scales by the range the *source* declares, and the compositor's
    output is in the working space, not in the range of whatever clip it came
    from — so the range the export asks for is the range the pixels are in. An
    unspecified export gets FFmpeg's default, which is limited.
    """
    return int(colour.range) if colour.range is not ColourRange.UNSPECIFIED else 0


# ---------------------------------------------------------------------------
# The renderer
# ---------------------------------------------------------------------------


class PyAVRenderer:
    """Opens render targets. The factory behind the handle.

    Holds no per-render state: one instance serves every export in the process,
    and the capability probe it was given is shared rather than rebuilt.
    """

    def __init__(
        self,
        *,
        probe: CapabilityProbe | None = None,
        clock: MonotonicReading | None = None,
    ) -> None:
        self._probe: Any = probe if probe is not None else PyAVCapabilityProbe()
        self._clock = clock if clock is not None else SystemClock()

    def open(
        self,
        spec: OutputSpec,
        path: str,
        *,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> Result[RenderTarget]:
        """Open `path` for writing `spec`, or say why it cannot be done.

        Declared as the port's `RenderTarget` rather than the concrete class: a
        caller that only knows the port must be able to hold what comes back.

        `is_cancelled` is how a job's cancellation reaches a sink: a bare
        callable, like every other injected collaborator in this codebase, so
        that a renderer never has to know what a job is.
        """
        writable = _check_destination(path)
        if writable is not None:
            return failed(writable)

        capabilities = self._probe.capabilities()
        if capabilities.is_err():
            return failed(capabilities.unwrap_err())

        refusal = _refuse_spec(spec, capabilities.unwrap())
        if refusal is not None:
            return failed(refusal)

        encoder = spec.video.encoder_name
        rejected = _prove_encoder(spec)
        if rejected is not None:
            return failed(rejected)

        muxer = MUXERS[spec.container]
        try:
            destination = Path(path)
            handle = tempfile.mkstemp(
                dir=str(destination.parent.resolve()),
                prefix=f".{destination.name}.",
                suffix=".part",
            )
            temporary = handle[1]
            os.close(handle[0])
        except OSError as error:
            return failed(_unwritable(str(error), path=path))

        try:
            container = av.open(
                temporary,
                "w",
                format=muxer,
                options=_container_options(spec),
            )
        except (OSError, ValueError, av.FFmpegError) as error:
            _unlink(temporary)
            return failed(
                _unwritable(f"{path} could not be opened for writing ({error})", path=path)
            )

        try:
            target = PyAVRenderTarget(
                container,
                spec=spec,
                temporary=temporary,
                destination=path,
                clock=self._clock,
                is_cancelled=is_cancelled,
            )
        except Exception as error:
            with contextlib.suppress(Exception):
                container.close()
            _unlink(temporary)
            return failed(_encode_failed(f"{path} could not be started ({error})", encoder=encoder))
        return ok(target)


def _container_options(spec: OutputSpec) -> dict[str, str]:
    """Container-level options: only faststart, and only where it means something.

    Moving the index to the front is what lets a web player start before the
    whole file has arrived. It costs a second pass over the file at `finish`,
    which is why it is asked for rather than assumed.
    """
    if spec.faststart and spec.container in (ContainerFormat.MP4, ContainerFormat.MOV):
        return {"movflags": "+faststart"}
    return {}


def _check_destination(path: str) -> NovaError | None:
    """Whether the directory the file is going into can take it."""
    if not path:
        return _unwritable("no output path was given")
    parent = Path(path).parent.resolve()
    if not parent.is_dir():
        return _unwritable(f"the folder {parent} does not exist", path=path)
    if not os.access(parent, os.W_OK):
        return _unwritable(f"the folder {parent} is read-only", path=path)
    return None


def _refuse_spec(spec: OutputSpec, capabilities: ToolchainCapabilities) -> NovaError | None:
    """The reason this machine cannot produce `spec`, or `None`.

    Checked in the order a user would want to hear it: "this machine has no
    NVENC" before "no h264_nvenc encoder", because the first is actionable and
    the second is a restatement. The remedy is the domain's own sentence —
    `ToolchainCapabilities.describe_missing` is written for a person.
    """
    missing = capabilities.describe_missing(spec)
    if not missing:
        return None
    if spec.video.hardware is not HardwareAccel.NONE and not capabilities.supports_hardware(
        spec.video.hardware
    ):
        return _encoder_unavailable(missing, remedy=missing, encoder=spec.video.encoder_name)
    if not capabilities.supports_encoder(spec.video.encoder_name):
        return _encoder_unavailable(missing, remedy=missing, encoder=spec.video.encoder_name)
    if not capabilities.supports_pixel_format(spec.video.pixel_format):
        return _unsupported_spec(
            missing, pixel_format=spec.video.pixel_format, encoder=spec.video.encoder_name
        )
    return _encoder_unavailable(missing, remedy=missing, encoder=spec.video.encoder_name)


def _prove_encoder(spec: OutputSpec) -> NovaError | None:
    """Open a throwaway encoder with the real geometry and options.

    The one check that cannot be answered from a list. A DNxHD stream is only
    defined for a handful of resolution, rate and bit-rate combinations; a
    hardware encoder may be present and unusable; a pixel format may be
    convertible by `swscale` and still refused by the codec. Asking the encoder
    itself costs one context open — milliseconds — and moves all of it to before
    the first frame is composed.
    """
    encoder = spec.video.encoder_name
    try:
        context: Any = av.codec.Codec(encoder, "w").create()
        context.width = spec.video.width
        context.height = spec.video.height
        context.pix_fmt = spec.video.pixel_format
        context.time_base = Fraction(spec.video.timebase.den, spec.video.timebase.num)
        with contextlib.suppress(Exception):
            context.options = _video_options(spec.video)
        context.open()
    except Exception as error:
        return _unsupported_spec(
            f"{encoder} refused this export: {error}",
            encoder=encoder,
            width=spec.video.width,
            height=spec.video.height,
            pixel_format=spec.video.pixel_format,
        )
    return None


def _unlink(path: str) -> None:
    """Remove a file that may already be gone. A cleanup that raises is a bug."""
    with contextlib.suppress(OSError):
        Path(path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# The target
# ---------------------------------------------------------------------------


class _State(Enum):
    OPEN = "open"
    FINISHED = "finished"
    ABANDONED = "abandoned"


class PyAVRenderTarget:
    """One output file, written to a sibling and published at the end.

    The file the caller asked for does not exist until `finish` succeeds. That
    is the port's rule 3 made concrete: a render interrupted by a crash, a
    cancellation or a full disk leaves the previous export intact and a `.part`
    file next to it that `abort` removes.
    """

    def __init__(
        self,
        container: Any,
        *,
        spec: OutputSpec,
        temporary: str,
        destination: str,
        clock: MonotonicReading,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> None:
        self._container = container
        self._spec = spec
        self._temporary = temporary
        self._destination = destination
        self._clock = clock
        self._is_cancelled = is_cancelled or (lambda: False)
        self._started = clock.monotonic()
        self._video: PyAVFrameSink | None = None
        self._audio: PyAVAudioSink | None = None
        self._state = _State.OPEN
        self._finished: Result[RenderStats] | None = None
        self._add_streams()

    # -- streams -----------------------------------------------------------

    def video(self) -> PyAVFrameSink:
        """The video stream of this output."""
        assert self._video is not None
        return self._video

    def audio(self) -> PyAVAudioSink | None:
        """The audio stream, or `None` when the spec has no audio."""
        return self._audio

    # -- finishing ---------------------------------------------------------

    def finish(self) -> Result[RenderStats]:
        """Flush every stream, close the container and publish the file."""
        if self._finished is not None:
            return self._finished
        if self._state is _State.ABANDONED:
            return failed(_cancelled())

        if self._video is not None:
            video = self._video.finish()
            if video.is_err():
                self.abort()
                return failed(video.unwrap_err())
        if self._audio is not None:
            audio = self._audio.finish()
            if audio.is_err():
                self.abort()
                return failed(audio.unwrap_err())

        try:
            self._container.close()
        except (OSError, ValueError, av.FFmpegError) as error:
            self.abort()
            return failed(_encode_failed(f"the file could not be finalised ({error})"))

        try:
            Path(self._temporary).replace(self._destination)
        except OSError as error:
            self.abort()
            return failed(_unwritable(f"{self._destination} could not be written ({error})"))

        self._state = _State.FINISHED
        elapsed = int((self._clock.monotonic() - self._started) * 1000)
        self._finished = ok(
            RenderStats(
                frames_written=self._video.frames_written if self._video else 0,
                bytes_written=_size_of(self._destination),
                elapsed_ms=elapsed,
            )
        )
        return self._finished

    def abort(self) -> None:
        """Abandon the render and remove the partial file. Idempotent."""
        if self._state is _State.FINISHED:
            return
        self._state = _State.ABANDONED
        if self._video is not None:
            self._video.abort()
        if self._audio is not None:
            self._audio.abort()
        with contextlib.suppress(Exception):
            self._container.close()
        _unlink(self._temporary)

    # -- internals ---------------------------------------------------------

    def _add_streams(self) -> None:
        """Declare the streams, before anything is written.

        Every stream is declared here and nowhere else: PyAV fixes a stream's
        time base when the container's header is written, and one added
        afterwards has none — which surfaces as "cannot rebase to zero time", a
        message that names neither the cause nor the stream.
        """
        video_spec = self._spec.video
        stream = self._container.add_stream(
            video_spec.encoder_name,
            rate=Fraction(video_spec.timebase.num, video_spec.timebase.den),
        )
        stream.width = video_spec.width
        stream.height = video_spec.height
        stream.pix_fmt = video_spec.pixel_format
        stream.codec_context.time_base = Fraction(video_spec.timebase.den, video_spec.timebase.num)
        for name, value in _colour_tags(video_spec.colour).items():
            setattr(stream.codec_context, name, value)
        stream.options = _video_options(video_spec)
        self._video = PyAVFrameSink(
            container=self._container,
            stream=stream,
            spec=video_spec,
            is_cancelled=self._is_cancelled,
        )

        if self._spec.audio is not None:
            audio = self._container.add_stream(
                self._spec.audio.encoder_name, rate=self._spec.audio.sample_rate
            )
            audio.codec_context.layout = f"{self._spec.audio.channels}c"
            audio.options = _audio_options(self._spec.audio)
            self._audio = PyAVAudioSink(
                container=self._container,
                stream=audio,
                spec=self._spec.audio,
                is_cancelled=self._is_cancelled,
            )


def _size_of(path: str) -> int:
    """The size of a file on disk, or 0 when it cannot be asked.

    A stats object is evidence for the export history, not a place for a
    filesystem error to surface.
    """
    with contextlib.suppress(OSError):
        return Path(path).stat().st_size
    return 0


# ---------------------------------------------------------------------------
# The sinks
# ---------------------------------------------------------------------------


class PyAVFrameSink:
    """One video stream: composed frames in, encoded packets in the container."""

    def __init__(
        self,
        *,
        container: Any,
        stream: Any,
        spec: VideoEncodeSpec,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> None:
        self._container = container
        self._stream = stream
        self._is_cancelled = is_cancelled or (lambda: False)
        self._spec = spec
        self._pix_fmt = spec.pixel_format
        self._range = _conversion_range(spec.colour)
        self._dst_space = (
            int(spec.colour.space) if spec.colour.space is not ColourSpace.UNSPECIFIED else None
        )
        self._written = 0
        self._bytes = 0
        self._state = _State.OPEN
        self._finished: Result[RenderStats] | None = None

    @property
    def frames_written(self) -> int:
        """Frames accepted so far. A job samples this to report progress."""
        return self._written

    def write(self, frame: FrameBuffer) -> Result[None]:
        """Encode one frame, converting its colour at this boundary."""
        if self._state is not _State.OPEN:
            return failed(_encode_failed("the video stream is already closed", frame=self._written))
        if self._is_cancelled():
            return failed(_cancelled())
        try:
            encoded = self._convert(frame)
            encoded.pts = self._written
            for packet in self._stream.encode(encoded):
                self._container.mux(packet)
                self._bytes += int(packet.size or 0)
        except (OSError, ValueError, av.FFmpegError) as error:
            return failed(_encode_failed(str(error), frame=self._written))
        self._written += 1
        return ok(None)

    def finish(self) -> Result[RenderStats]:
        """Flush the encoder's delay and close this stream.

        A modern codec holds frames back — lookahead, B-frame reordering — so a
        render that stops after the last `write` loses the tail of the clip.
        """
        if self._finished is not None:
            return self._finished
        if self._state is _State.ABANDONED:
            return failed(_cancelled())
        try:
            for packet in self._stream.encode():
                self._container.mux(packet)
                self._bytes += int(packet.size or 0)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._state = _State.ABANDONED
            return failed(_encode_failed(f"the encoder would not flush ({error})"))
        self._state = _State.FINISHED
        self._finished = ok(RenderStats(frames_written=self._written, bytes_written=self._bytes))
        return self._finished

    def abort(self) -> None:
        """Abandon this stream. Idempotent."""
        if self._state is _State.FINISHED:
            return
        self._state = _State.ABANDONED
        self._finished = None

    # -- internals ---------------------------------------------------------

    def _convert(self, frame: FrameBuffer) -> Any:
        """RGB in the compositor's working space → the encoder's pixel format.

        The size is passed through to `reformat`: a frame that is not the size
        the spec declares is scaled rather than rejected, because stopping an
        export at frame 40 000 over a mismatch is not a thing a user can act on,
        while the render service that produced the frame is a thing a test can.
        """
        source_format = _SOURCE_FORMATS[frame.channels]
        source = av.VideoFrame.from_ndarray(frame.pixels, format=source_format)
        source.color_range = self._range
        src_space = (
            int(frame.colour.space) if frame.colour.space is not ColourSpace.UNSPECIFIED else None
        )
        converted = source.reformat(
            width=self._spec.width,
            height=self._spec.height,
            format=self._pix_fmt,
            src_colorspace=src_space,
            dst_colorspace=self._dst_space,
        )
        return converted


class PyAVAudioSink:
    """One audio stream: mixed blocks in, encoded packets in the container.

    Resampling is done here because the output's rate and channel count are a
    property of the *export*, not of the mix: a 48 kHz timeline can be exported
    at 44.1 kHz without anyone upstream being told.
    """

    def __init__(
        self,
        *,
        container: Any,
        stream: Any,
        spec: AudioEncodeSpec,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> None:
        self._container = container
        self._stream = stream
        self._is_cancelled = is_cancelled or (lambda: False)
        self._spec = spec
        self._format = _encoder_sample_format(stream)
        self._layout = f"{spec.channels}c"
        self._resamplers: dict[tuple[int, int], Any] = {}
        self._written = 0
        self._samples = 0
        self._bytes = 0
        self._state = _State.OPEN
        self._finished: Result[RenderStats] | None = None

    @property
    def blocks_written(self) -> int:
        """Sample blocks accepted so far."""
        return self._written

    def write(self, buffer: AudioBuffer) -> Result[None]:
        """Encode one block of samples, resampled to the output's rate and layout."""
        if self._state is not _State.OPEN:
            return failed(_encode_failed("the audio stream is already closed", block=self._written))
        if self._is_cancelled():
            return failed(_cancelled())
        if buffer.frame_count == 0:
            return ok(None)
        try:
            resampler = self._resampler_for(buffer.sample_rate, buffer.channels)
            source = av.AudioFrame.from_ndarray(
                np.ascontiguousarray(buffer.samples.T),
                format="fltp",
                layout=f"{buffer.channels}c",
            )
            source.sample_rate = buffer.sample_rate
            for resampled in resampler.resample(source):
                self._emit(resampled)
        except (OSError, ValueError, av.FFmpegError) as error:
            return failed(_encode_failed(str(error), block=self._written))
        self._written += 1
        return ok(None)

    def finish(self) -> Result[RenderStats]:
        """Flush every resampler and the encoder, then close this stream."""
        if self._finished is not None:
            return self._finished
        if self._state is _State.ABANDONED:
            return failed(_cancelled())
        try:
            for resampler in self._resamplers.values():
                for resampled in resampler.resample(None):
                    self._emit(resampled)
            self._resamplers.clear()
            for packet in self._stream.encode():
                self._container.mux(packet)
                self._bytes += int(packet.size or 0)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._state = _State.ABANDONED
            return failed(_encode_failed(f"the audio encoder would not flush ({error})"))
        self._state = _State.FINISHED
        self._finished = ok(
            RenderStats(
                # `RenderStats` counts what arrived; for audio that is a block,
                # because a block is the unit the mixer produced.
                frames_written=self._written,
                bytes_written=self._bytes,
            )
        )
        return self._finished

    def abort(self) -> None:
        """Abandon this stream. Idempotent."""
        if self._state is _State.FINISHED:
            return
        self._state = _State.ABANDONED
        self._resamplers.clear()
        self._finished = None

    # -- internals ---------------------------------------------------------

    def _resampler_for(self, sample_rate: int, channels: int) -> Any:
        """One resampler per source rate and channel count.

        libswresample carries delay between calls, so a resampler is per source
        shape and is flushed at `finish` — mixing a 44.1 kHz clip into a 48 kHz
        export must not leak the tail of one block into the head of the next.
        """
        key = (sample_rate, channels)
        resampler = self._resamplers.get(key)
        if resampler is None:
            resampler = av.AudioResampler(
                format=self._format, layout=self._layout, rate=self._spec.sample_rate
            )
            self._resamplers[key] = resampler
        return resampler

    def _emit(self, resampled: Any) -> None:
        resampled.pts = self._samples
        self._samples += int(resampled.samples)
        for packet in self._stream.encode(resampled):
            self._container.mux(packet)
            self._bytes += int(packet.size or 0)


def _encoder_sample_format(stream: Any) -> str:
    """The sample format the encoder wants, as the stream was created.

    AAC takes planar float, PCM takes packed 16-bit, and libmp3lame wants 32-bit
    planar — all of which is the encoder's business, not the mixer's, so it is
    read back from the context rather than tabulated here.
    """
    with contextlib.suppress(Exception):
        name = stream.codec_context.format
        if name is not None:
            return str(name.name)
    return "fltp"
