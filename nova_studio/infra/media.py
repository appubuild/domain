"""L1 — the PyAV prober: what a media file says about itself.

This is the first adapter behind `ports/media.py`, and it answers one question:
**what is in this file?** It opens the container, reads the stream headers and the
container tags, and closes it. It decodes nothing, seeks nowhere, and holds
nothing open — which is what makes it cheap enough to run over a folder of
forty imports without a progress dialog.

It also answers the second question — **what is in this frame?** — through
:class:`PyAVDecoder`, which opens a file for decoding and hands back one source
per stream. Probing and decoding live in one module because they share the one
thing worth sharing: the mapping from FFmpeg's vocabulary to the domain's. A
prober and a decoder that disagreed about what a file contains would be two bugs
for the price of one.

What it is *not*: this module does not composite, cache frames or build proxies.
Frames are handed over as the domain's `FrameBuffer` and the render pipeline
decides what to do with them.

**A handle is not shared.** One `DecodedMedia` owns one container, and a seek on
one of its sources moves the container for all of them, so a source is used by
one consumer at a time. That is why `ports/media.py` calls for a *handle* the
pool can hand out per task (ADR-0007 §5) rather than one handle for the
application.

**Failures are values.** Every way a file can be unusable comes back as an `Err`
with one of the port's own codes:

* `NS-MEDIA-4001` — the path is empty, is not there, is a directory, or is not a
  container FFmpeg can open. The user's problem: they picked the wrong file.
* `NS-MEDIA-4003` — the container opened and names a codec this build has no
  decoder for. Ours: the same file will import on a build with the codec.

Telling those apart is the whole point of the port, so the mapping is done once,
here, from the exception FFmpeg actually raises.

**Numbers are exact.** A rate is a `Timebase`, not a float: `30000/1001` stays
`30000/1001` and does not become 29.97002997002997 on its way to the timeline,
because a frame count derived from a rounded rate drifts by a frame every few
minutes of footage.

**Two honest limitations**, both recorded rather than papered over:

* **Rotation.** PyAV 18 exposes no stream side data, so a clip whose rotation
  lives only in a `DISPLAYMATRIX` (most phone footage) reports `0` and will be
  laid out sideways until the FFmpeg-CLI adapter (ADR-0007 §2) or a newer PyAV
  makes it readable. The `rotate` container tag — which many encoders *do* write —
  is read.
* **Frame counts.** A container without an index reports `0`, which the domain
  already treats as "unknown" rather than "empty". Guessing a count from a bitrate
  would produce a number that looks authoritative and is wrong.

**Caching.** None, and deliberately: a probe is a few milliseconds and its result
is stored on the asset (`MediaInfo` is the one part of a probe the project file
persists, ADR-0015). A cache here would be a second copy of the project's own
record, with all the staleness that implies.

**Testing.** `tests/infra/test_media_probe.py` encodes real files with PyAV — a
29.97 clip with audio, a still, an audio-only file, a directory, a text file —
and pins what comes back. No golden files, because a media fixture in a
repository is a file nobody can regenerate when the toolchain moves.
"""

from __future__ import annotations

import contextlib
from fractions import Fraction
from typing import TYPE_CHECKING, Any, Final

import av
import numpy as np

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import (
    AssetKind,
    AudioBuffer,
    AudioStreamInfo,
    ColourMeta,
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
    FrameBuffer,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import MediaErrorCode

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence

__all__ = [
    "AV_TIME_BASE",
    "PyAVAudioSource",
    "PyAVDecoder",
    "PyAVMedia",
    "PyAVProber",
    "PyAVResampler",
    "PyAVVideoSource",
]

#: FFmpeg's own time base: microseconds. Container durations are reported in it.
AV_TIME_BASE: Final[int] = 1_000_000

#: The rate a single frame is described with. A still has no rate of its own —
#: the timeline decides how long it is shown — so the domain's convention is a
#: nominal 1/1 rather than whatever rate the container guessed at.
_NOMINAL_STILL_RATE: Final[Timebase] = Timebase.of(1, 1)

#: The rate to report for a moving picture that says nothing about its own. A
#: clip without a rate cannot be placed on a timeline at all, and a nominal rate
#: at least lets the user see it and replace it.
_FALLBACK_VIDEO_RATE: Final[Timebase] = Timebase.of(30, 1)

#: Codecs whose streams are one picture. A container opened through an image
#: demuxer (`png_pipe`, `image2`) reports no frame count and no duration, and a
#: still described as "zero frames" would not be importable as a clip.
_STILL_CODECS: Final[frozenset[str]] = frozenset(
    {
        "apng",
        "bmp",
        "dpx",
        "exr",
        "gif",
        "jpeg2000",
        "mjpeg",
        "pam",
        "pbm",
        "pgm",
        "png",
        "ppm",
        "rawvideo",
        "tiff",
        "webp",
    }
)


class PyAVProber:
    """Reads what a file says about itself, through PyAV.

    Stateless and safe to share: one instance can serve the whole application,
    which is how the workspace uses it.
    """

    def probe(self, path: str) -> Result[MediaInfo]:
        """Describe `path`, or say why it cannot be described."""
        if not path:
            return failed(_unreadable("the path is empty"))
        try:
            with av.open(path, metadata_errors="ignore") as container:
                return ok(describe_container(container))
        except _UnsupportedFileError as unsupported:
            return failed(unsupported.error)
        except (av.error.FileNotFoundError, FileNotFoundError):
            return failed(_unreadable(f"{path} could not be opened: there is no such file"))
        except (av.error.IsADirectoryError, IsADirectoryError):
            return failed(_unreadable(f"{path} is a directory, not a media file"))
        except av.error.InvalidDataError as error:
            return failed(_unreadable(f"{path} is not a media file ({error})"))
        except NovaInvariantError as error:
            # A file whose description breaks the domain's own invariants — a
            # zero-width stream, a negative duration — is a file we cannot
            # describe, not a bug in the domain.
            return failed(_unreadable(f"{path} describes itself incoherently ({error})"))
        except (OSError, ValueError, av.FFmpegError) as error:
            # `av.FFmpegError` is the base of every FFmpeg failure; the ones above
            # are the ones a user can act on, and everything else is reported as
            # unreadable rather than as a crash.
            return failed(_unreadable(f"{path} could not be read ({error})"))

    # -- describing -------------------------------------------------------

    def _describe(self, container: Any, path: str) -> MediaInfo:
        """Kept as a method because the prober is the public face of probing;
        the work is module-level so a decoder opening the same file describes it
        the same way."""
        return describe_container(container)


def describe_container(container: Any) -> MediaInfo:
    """What this open container holds, in the domain's vocabulary.

    Shared by the prober and the decoder, because a file described two ways is a
    file that eventually gets decoded against the wrong geometry.
    """
    video: list[VideoStreamInfo] = []
    audio: list[AudioStreamInfo] = []
    subtitles = 0
    other = 0

    for stream in container.streams:
        kind = stream.type
        if kind == "video":
            video.append(_video_stream(stream))
        elif kind == "audio":
            audio.append(_audio_stream(stream))
        elif kind == "subtitle":
            subtitles += 1
        else:
            other += 1

    unsupported = _unsupported_codec(container)
    if unsupported is not None:
        # Reported instead of a summary, not alongside one: a description of a
        # file we cannot decode would be believed.
        raise _UnsupportedFileError(unsupported)

    return MediaInfo(
        kind=_kind_of(video, audio),
        container_format=_format_name(container),
        duration_seconds=_duration_seconds(container, video, audio),
        bit_rate=int(container.bit_rate or 0),
        video=tuple(video),
        audio=tuple(audio),
        subtitle_count=subtitles,
        other_stream_count=other,
        metadata=_metadata(container),
    )


class _UnsupportedFileError(Exception):
    """Carries the `NS-MEDIA-4003` answer out of `_describe`.

    An exception rather than a return value because the discovery happens deep in
    a loop over streams that has already built half a summary; it is caught in
    `probe` and becomes an `Err`, so nothing outside this module sees it.
    """

    def __init__(self, error: NovaError) -> None:
        super().__init__(str(error))
        self.error = error


def _unreadable(reason: str) -> NovaError:
    return NovaError(
        MediaErrorCode.UNREADABLE,
        "this file could not be read",
        domain=ErrorDomain.MEDIA,
        cause=reason,
        remedy="Check that the file exists and is a media file this build can decode.",
        retryable=False,
    )


def _unsupported(codec: str) -> NovaError:
    return NovaError(
        MediaErrorCode.UNSUPPORTED,
        f"this build has no decoder for '{codec}'",
        domain=ErrorDomain.MEDIA,
        details={"codec": codec},
        remedy=(
            "Install a build with the codec, or switch to the command-line "
            "backend, which can carry codecs PyAV does not."
        ),
        retryable=False,
    )


# -- one stream -----------------------------------------------------------


def _video_stream(stream: Any) -> VideoStreamInfo:
    codec = stream.codec_context
    name = codec.name or "unknown"
    rate = _rate_of(stream)
    frames = _frame_count(stream, rate, codec_name=name)
    if frames == 1:
        rate = _NOMINAL_STILL_RATE
    return VideoStreamInfo(
        codec_name=name,
        width=int(codec.width or 0) or 1,
        height=int(codec.height or 0) or 1,
        timebase=rate,
        index=int(stream.index),
        frame_count=frames,
        pixel_format=getattr(codec, "pix_fmt", "") or "",
        colour=_colour_of(codec),
        rotation=_rotation_of(stream),
        sample_aspect_ratio=_aspect_of(stream),
    )


def _rate_of(stream: Any) -> Timebase:
    """The stream's frame rate, as an exact rational.

    `average_rate` is what a constant-rate file declares and what a timeline
    wants; `base_rate` is the container's guess for a variable-rate stream. A
    stream that says neither gets 1/1 (a still) or 30/1 (a moving picture),
    because a clip without a rate is a clip that cannot be placed at all.
    """
    for candidate in ("average_rate", "base_rate"):
        value = getattr(stream, candidate, None)
        if value:
            fraction = Fraction(value.numerator, value.denominator)
            if fraction > 0:
                return Timebase.of(fraction.numerator, fraction.denominator)
    return _FALLBACK_VIDEO_RATE


def _frame_count(stream: Any, rate: Timebase, *, codec_name: str) -> int:
    """How many frames the stream has, or `0` when the container does not say.

    An image demuxer reports neither a count nor a duration and is still exactly
    one picture, which is the one case where the answer is known without being
    told. Everything else that reports nothing stays at `0`: a stream being
    written, or a container with no index, and guessing a count from a bitrate
    would produce a number that looks authoritative and is wrong.
    """
    declared = int(getattr(stream, "frames", 0) or 0)
    if declared > 0:
        return declared
    duration = getattr(stream, "duration", None)
    base = getattr(stream, "time_base", None)
    if duration and base:
        seconds = Fraction(int(duration) * base.numerator, base.denominator)
        return int(seconds * Fraction(rate.num, rate.den))
    return 1 if codec_name in _STILL_CODECS else 0


def _colour_of(codec: Any) -> ColourMeta:
    """The four colour tags, mapped by their FFmpeg numbers.

    A tag FFmpeg reports and the domain does not know is dropped to
    `UNSPECIFIED` rather than raising: an unknown colour tag is a file being
    modern, and refusing to import it would be a bigger mistake than grading it
    by its declared space alone.
    """
    return ColourMeta(
        space=_tag(ColourSpace, getattr(codec, "colorspace", None)),
        range=_tag(ColourRange, getattr(codec, "color_range", None)),
        primaries=_tag(ColourPrimaries, getattr(codec, "color_primaries", None)),
        transfer=_tag(ColourTransfer, getattr(codec, "color_trc", None)),
    )


def _tag(enum: Any, value: Any) -> Any:
    number = int(getattr(value, "value", value if isinstance(value, int) else 0) or 0)
    try:
        return enum(number)
    except ValueError:
        return enum(0)


def _rotation_of(stream: Any) -> int:
    """Degrees to rotate for display, from the `rotate` tag.

    The tag is written by many encoders (and by every consumer phone we have
    tested that does *not* use side data). It is 0, 90, 180 or 270; a negative
    value is a counter-clockwise angle in the same set, and anything else is
    nonsense a broken file wrote, so it is read as "not rotated".
    """
    raw = (stream.metadata or {}).get("rotate", "") if hasattr(stream, "metadata") else ""
    try:
        degrees = int(str(raw).strip())
    except ValueError:
        return 0
    degrees %= 360
    return degrees if degrees in (0, 90, 180, 270) else 0


def _aspect_of(stream: Any) -> Fraction:
    """Pixel aspect ratio, 1/1 when the file does not say.

    Non-square pixels are ordinary in broadcast footage (PAL 4:3 is 12:11) and
    ignoring them is how a circle becomes an ellipse.
    """
    value = getattr(stream, "sample_aspect_ratio", None)
    if not value:
        return Fraction(1)
    fraction = Fraction(int(value.numerator), int(value.denominator))
    return fraction if fraction > 0 else Fraction(1)


def _audio_stream(stream: Any) -> AudioStreamInfo:
    codec = stream.codec_context
    layout = getattr(codec, "layout", None)
    audio_format = getattr(codec, "format", None)
    return AudioStreamInfo(
        codec_name=codec.name or "unknown",
        sample_rate=int(codec.sample_rate or 0) or 48_000,
        channels=int(getattr(codec, "channels", 0) or 0) or 2,
        index=int(stream.index),
        sample_count=_sample_count(stream),
        sample_format=getattr(audio_format, "name", "") if audio_format is not None else "",
        channel_layout=getattr(layout, "name", "") if layout is not None else "",
    )


def _sample_count(stream: Any) -> int:
    """Samples in the stream, from its duration when the container did not count them.

    `stream.frames` counts *packets* for audio, which is why it is not the answer:
    an AAC packet holds 1024 samples, so a count of packets would understate the
    length of the audio by a factor of a thousand.
    """
    duration = getattr(stream, "duration", None)
    base = getattr(stream, "time_base", None)
    rate = getattr(stream.codec_context, "sample_rate", 0) or 0
    if duration and base and rate:
        return int(Fraction(int(duration) * base.numerator, base.denominator) * rate)
    return 0


# -- the file as a whole --------------------------------------------------


def _kind_of(video: list[VideoStreamInfo], audio: list[AudioStreamInfo]) -> AssetKind:
    """What the file is, decided by its contents and never by its suffix.

    Cover art is the case that makes this worth thinking about: an MP3 with a
    picture is audio, and so is a video file whose only video stream is a single
    frame. A moving picture with no sound is still a moving picture.
    """
    moving = [stream for stream in video if stream.frame_count > 1]
    if moving:
        return AssetKind.VIDEO
    if video and not audio:
        return AssetKind.IMAGE
    if audio:
        return AssetKind.AUDIO
    return AssetKind.UNKNOWN


def _duration_seconds(
    container: Any, video: list[VideoStreamInfo], audio: list[AudioStreamInfo]
) -> float:
    """The file's length: the container's word, then the longest stream's."""
    declared = getattr(container, "duration", None)
    if declared:
        return max(0.0, int(declared) / AV_TIME_BASE)
    candidates: list[float] = [stream.duration_seconds for stream in video]
    candidates.extend(stream.duration_seconds for stream in audio)
    return max(candidates) if candidates else 0.0


def _format_name(container: Any) -> str:
    """One name for the muxer.

    FFmpeg names a format as the list of extensions it answers to
    (`mov,mp4,m4a,3gp,3g2,mj2`); the first is the one a person would call it.
    """
    name = str(getattr(container.format, "name", "") or "")
    return name.split(",")[0] if name else ""


def _metadata(container: Any) -> Mapping[str, str]:
    """Container tags: informational, never used to decode.

    Copied into a plain dict so the summary does not hold a live handle to the
    container it came from — a probe must outlive the file it read.
    """
    tags = getattr(container, "metadata", None) or {}
    return {str(key): str(value) for key, value in dict(tags).items()}


def _unsupported_codec(container: Any) -> NovaError | None:
    """The first stream this build cannot decode, if there is one."""
    available = av.codecs_available
    for stream in container.streams:
        name = getattr(stream.codec_context, "name", "") or ""
        if name and name not in available:
            return _unsupported(name)
    return None


# ---------------------------------------------------------------------------
# Decoding
# ---------------------------------------------------------------------------


def _decode_failed(reason: str, *, position: object = None) -> NovaError:
    """A read that ended in damage rather than at the end of the stream.

    `details` names the position because "this clip is damaged at 00:03:12" is a
    sentence a user can act on, and a render job can put in its own `Err`.
    """
    return NovaError(
        MediaErrorCode.DECODE_FAILED,
        "this file could not be decoded",
        domain=ErrorDomain.MEDIA,
        cause=reason,
        details={} if position is None else {"position": str(position)},
        remedy="The file is damaged or was truncated; re-copy it from the source, or replace the clip.",
        retryable=False,
    )


class _ReadPosition:
    """Whether the container is still where a caller last left it.

    One per handle, shared by every source on it, because `container.decode`
    demuxes the whole file and discards the packets of the stream you did not
    ask for: a video read moves the audio position too. The flag is what keeps a
    second read from quietly continuing where the first one stopped.
    """

    __slots__ = ("stale",)

    def __init__(self) -> None:
        self.stale = False


class PyAVDecoder:
    """Opens files for decoding. Stateless, like the prober."""

    def open(self, path: str) -> Result[Any]:
        """Open `path` and hand back a handle, or the reason it would not open."""
        if not path:
            return failed(_unreadable("the path is empty"))
        try:
            container = av.open(path, metadata_errors="ignore")
        except (av.error.FileNotFoundError, FileNotFoundError):
            return failed(_unreadable(f"{path} could not be opened: there is no such file"))
        except (av.error.IsADirectoryError, IsADirectoryError):
            return failed(_unreadable(f"{path} is a directory, not a media file"))
        except av.error.InvalidDataError as error:
            return failed(_unreadable(f"{path} is not a media file ({error})"))
        except NovaInvariantError as error:
            return failed(_unreadable(f"{path} describes itself incoherently ({error})"))
        except (OSError, ValueError, av.FFmpegError) as error:
            return failed(_unreadable(f"{path} could not be read ({error})"))
        try:
            info = describe_container(container)
        except _UnsupportedFileError as unsupported:
            container.close()
            return failed(unsupported.error)
        except (OSError, ValueError, av.FFmpegError) as error:  # pragma: no cover - defensive
            container.close()
            return failed(_unreadable(f"{path} could not be read ({error})"))
        return ok(PyAVMedia(container, info))


class PyAVMedia:
    """An open file: one container, one probe summary, sources on demand.

    A handle, not a value: it owns native resources and is closed exactly once —
    by the pool that evicts it, or by a `finally` in the caller, whichever comes
    first, which is why `close` is idempotent.
    """

    def __init__(self, container: Any, info: MediaInfo) -> None:
        self._container = container
        self._info = info
        self._sources: list[Any] = []
        self._position = _ReadPosition()
        self._closed = False

    @property
    def is_closed(self) -> bool:
        """Whether this handle has been closed. A closed handle hands out nothing."""
        return self._closed

    def info(self) -> MediaInfo:
        return self._info

    def video(self, stream_index: int | None = None) -> PyAVVideoSource | None:
        """Open a video stream, or `None` when the file has none.

        `None` after `close`, too: a pooled handle that was evicted mid-task must
        answer a question, not hand back a source on a dead container.
        """
        if self._closed:
            return None
        stream = self._stream("video", stream_index)
        return None if stream is None else self._open_source(PyAVVideoSource, stream)

    def audio(self, stream_index: int | None = None) -> PyAVAudioSource | None:
        """Open an audio stream, or `None` when the file has none."""
        if self._closed:
            return None
        stream = self._stream("audio", stream_index)
        return None if stream is None else self._open_source(PyAVAudioSource, stream)

    def release(self, source: Any) -> None:
        """A source has closed; close the handle when the last one goes.

        Public because a source is not a subclass and should not reach inside
        the handle that owns it — and because a pool may close a source it did
        not open.
        """
        if source in self._sources:
            self._sources.remove(source)
        if not self._sources and not self._closed:
            self.close()

    def close(self) -> None:
        """Close every source opened from this handle, then the container."""
        if self._closed:
            return
        self._closed = True
        for source in tuple(self._sources):
            source.close()
        self._sources.clear()
        with contextlib.suppress(Exception):
            # A container that is already broken must not stop a pool from
            # releasing the rest of what it holds.
            self._container.close()

    # -- internals --------------------------------------------------------

    def _stream(self, kind: str, index: int | None) -> Any:
        streams = [stream for stream in self._container.streams if stream.type == kind]
        if not streams:
            return None
        if index is None:
            return streams[0]
        for stream in streams:
            if int(stream.index) == index:
                return stream
        return None

    def _open_source(self, factory: Any, stream: Any) -> Any:
        source = factory(self, self._container, stream, self._position)
        self._sources.append(source)
        return source


class PyAVVideoSource:
    """One decoded video stream.

    Frames come back as `FrameBuffer` — RGB24, `uint8`, tagged with the colour
    they were decoded as — because the domain refuses anything else, and an
    adapter that handed over `yuv420p` would push a conversion into every
    consumer.

    Seeking is the honest way round a GOP: `frame_at` seeks to the preceding
    keyframe and decodes forward, which is exactly what the port allows and what
    a caller that wants scrubbing performance asks for deliberately.
    """

    def __init__(
        self, owner: PyAVMedia, container: Any, stream: Any, position: _ReadPosition
    ) -> None:
        self._owner = owner
        self._container = container
        self._stream = stream
        self._position = position
        self._info = _video_stream(stream)
        self._rate = Fraction(self._info.timebase.num, self._info.timebase.den)
        self._error: NovaError | None = None
        self._keyframes: tuple[int, ...] | None = None
        self._closed = False

    def info(self) -> VideoStreamInfo:
        return self._info

    def frame_count(self) -> int:
        return self._info.frame_count

    def last_error(self) -> NovaError | None:
        return self._error

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._owner.release(self)

    # -- reading ----------------------------------------------------------

    def frames(self, start: int = 0, stop: int | None = None) -> Iterator[FrameBuffer]:
        """Yield frames from `start` up to but excluding `stop`, in decode order.

        A decode failure ends the iteration rather than raising out of it: the
        hot path must not allocate a `Result` per frame for something that
        happens once a year. `last_error` is the caller's channel.
        """
        self._error = None
        if self._closed:
            return
        # One seek per read, not per frame. A read is self-contained, so what the
        # handle was last asked for has no effect on what it answers next — and
        # it leaves the container stale either way, because an abandoned
        # generator stops wherever it stopped.
        stale = self._position.stale
        self._position.stale = True
        if stale or start > 0:
            seeked = self._seek_to_frame(start)
            # A file that cannot be seeked at all — a still, a pipe — is still
            # readable forwards, so long as the caller asked for its beginning.
            if not seeked and start > 0:
                return
        for frame in self._decode():
            index = self._index_of(frame)
            if index < start:
                continue
            if stop is not None and index >= stop:
                break
            yield self._as_buffer(frame)

    def frame_at(self, index: int) -> FrameBuffer | None:
        """Decode one frame, seeking back to the keyframe before it.

        Returns the first frame at or after `index`. A damaged file that is
        missing that frame costs the caller one frame, not the rest of the clip.
        """
        self._error = None
        if self._closed or index < 0:
            return None
        self._position.stale = True
        if not self._seek_to_frame(index) and index > 0:
            return None
        for frame in self._decode():
            if self._index_of(frame) >= index:
                return self._as_buffer(frame)
        return None

    def keyframe_indices(self) -> Sequence[int]:
        """Frame numbers that can be decoded without their neighbours.

        One pass over the container's packets, cached, and no frame is decoded:
        the scrubber and the pool both want this before they seek.
        """
        if self._keyframes is not None:
            return self._keyframes
        if self._closed:
            return ()
        found: list[int] = []
        self._position.stale = True
        try:
            for packet in self._container.demux(self._stream):
                if packet.pts is None or not packet.is_keyframe:
                    continue
                found.append(self._index_of(packet))
        except (OSError, ValueError, av.FFmpegError) as error:
            self._error = _decode_failed(str(error))
            return ()
        self._keyframes = tuple(found)
        return self._keyframes

    # -- internals --------------------------------------------------------

    def _decode(self) -> Iterator[Any]:
        """Frames from the current position, with failures latched not raised."""
        try:
            yield from self._container.decode(self._stream)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._error = _decode_failed(str(error))
            return

    def _seek_to_frame(self, index: int) -> bool:
        """Seek to the keyframe at or before `index`. False when it cannot."""
        try:
            self._container.seek(self._pts_of(index), stream=self._stream, backward=True)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._error = _decode_failed(str(error), position=index)
            return False
        return True

    def _index_of(self, source: Any) -> int:
        """A frame's (or packet's) number, from its presentation timestamp."""
        pts = int(source.pts or 0)
        base = self._stream.time_base
        seconds = Fraction(pts * base.numerator, base.denominator) if base else Fraction(0)
        return round(seconds * self._rate)

    def _pts_of(self, index: int) -> int:
        base = self._stream.time_base
        seconds = Fraction(index) / self._rate
        return round(seconds / Fraction(base.numerator, base.denominator))

    def _as_buffer(self, frame: Any) -> FrameBuffer:
        pixels = frame.to_ndarray(format="rgb24")
        return FrameBuffer(
            pixels=np.ascontiguousarray(pixels, dtype=np.uint8), colour=_colour_of(frame)
        )


class PyAVAudioSource:
    """One decoded audio stream, as blocks of interleaved float32.

    Blocks, because that is what a decoder produces: an AAC frame is 1024
    samples, and yielding single samples would be a per-sample call into
    libavcodec.
    """

    def __init__(
        self, owner: PyAVMedia, container: Any, stream: Any, position: _ReadPosition
    ) -> None:
        self._owner = owner
        self._container = container
        self._stream = stream
        self._position = position
        self._info = _audio_stream(stream)
        self._error: NovaError | None = None
        self._resampler: Any = None
        self._closed = False

    def info(self) -> AudioStreamInfo:
        return self._info

    def sample_count(self) -> int:
        return self._info.sample_count

    def last_error(self) -> NovaError | None:
        return self._error

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._resampler = None
        self._owner.release(self)

    # -- reading ----------------------------------------------------------

    def samples(self, start: int = 0, count: int | None = None) -> Iterator[AudioBuffer]:
        """Yield blocks of samples from `start`.

        The first block may begin slightly before `start`, because a decoder has
        to begin at a packet boundary; the port says so and the caller trims
        rather than assuming. `count` is a maximum number of *samples*, not of
        blocks, and a block is never split to land exactly on it.
        """
        self._error = None
        if self._closed or count == 0:
            return
        stale = self._position.stale
        self._position.stale = True
        if stale or start > 0:
            seeked = self._seek_to_sample(start)
            if not seeked and start > 0:
                return
        emitted = 0
        for frame in self._decode():
            block = self._as_buffer(frame)
            if block.frame_count == 0:
                continue
            yield block
            emitted += block.frame_count
            if count is not None and emitted >= count:
                return

    # -- internals --------------------------------------------------------

    def _decode(self) -> Iterator[Any]:
        try:
            yield from self._container.decode(self._stream)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._error = _decode_failed(str(error))
            return

    def _seek_to_sample(self, start: int) -> bool:
        rate = self._info.sample_rate
        base = self._stream.time_base
        try:
            seconds = Fraction(start, rate)
            target = round(seconds / Fraction(base.numerator, base.denominator))
            self._container.seek(target, stream=self._stream, backward=True)
        except (OSError, ValueError, av.FFmpegError) as error:
            self._error = _decode_failed(str(error), position=start)
            return False
        return True

    def _as_buffer(self, frame: Any) -> AudioBuffer:
        """One decoded frame as interleaved float32 in the nominal ±1.0 range.

        Anything the decoder produced that is not already float goes through
        libswresample first: everything downstream — waveform peaks, loudness,
        mixing, the export muxer — is written against one layout.
        """
        if not str(frame.format.name).startswith(("fl", "db")):
            frame = self._to_float(frame)
            if frame is None:  # pragma: no cover - resampler failure is latched
                return AudioBuffer(
                    samples=np.zeros((0, self._info.channels), dtype=np.float32),
                    sample_rate=self._info.sample_rate,
                )
        planar = frame.to_ndarray()
        interleaved = np.ascontiguousarray(planar.T, dtype=np.float32)
        return AudioBuffer(samples=interleaved, sample_rate=int(frame.sample_rate or 0))

    def _to_float(self, frame: Any) -> Any:
        if self._resampler is None:
            self._resampler = av.AudioResampler(
                format="fltp", layout=frame.layout.name, rate=int(frame.sample_rate or 0)
            )
        try:
            for resampled in self._resampler.resample(frame):
                return resampled
        except (OSError, ValueError, av.FFmpegError) as error:  # pragma: no cover
            self._error = _decode_failed(str(error))
            return None
        return None  # pragma: no cover - a frame always resamples to at least one


class PyAVResampler:
    """Converts decoded audio to the rate and channel count a caller asks for.

    Stateless from the caller's point of view; a resampler is created per call
    because libswresample is stateful and its output length is not a pure
    function of its input's — a shared one would leak delay between unrelated
    buffers.
    """

    def resample(self, buffer: AudioBuffer, *, sample_rate: int, channels: int) -> AudioBuffer:
        if sample_rate <= 0 or channels <= 0:
            raise NovaInvariantError(
                f"a resample target must be positive, got {sample_rate} Hz x {channels}"
            )
        if buffer.frame_count == 0:
            # Nothing to convert, and a zero-length frame is not a thing
            # libswresample will accept: a silent gap of no samples at all is a
            # caller asking for an empty buffer, not an error.
            return AudioBuffer(
                samples=np.zeros((0, channels), dtype=np.float32), sample_rate=sample_rate
            )
        # Two layouts, not one: the frame we hand to libswresample carries the
        # channels the buffer already has, and the resampler carries the ones the
        # caller asked for. Downmixing happens between them.
        resampler = av.AudioResampler(format="fltp", layout=f"{channels}c", rate=sample_rate)
        frame = av.AudioFrame.from_ndarray(
            np.ascontiguousarray(buffer.samples.T),
            format="fltp",
            layout=f"{buffer.channels}c",
        )
        frame.sample_rate = buffer.sample_rate
        blocks = [resampled.to_ndarray().T for resampled in resampler.resample(frame)]
        blocks.extend(resampled.to_ndarray().T for resampled in resampler.resample(None))
        if not blocks:
            return AudioBuffer(
                samples=np.zeros((0, channels), dtype=np.float32), sample_rate=sample_rate
            )
        joined = np.concatenate(blocks, axis=0)
        return AudioBuffer(
            samples=np.ascontiguousarray(joined, dtype=np.float32), sample_rate=sample_rate
        )
