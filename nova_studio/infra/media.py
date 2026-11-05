"""L1 — the PyAV prober: what a media file says about itself.

This is the first adapter behind `ports/media.py`, and it answers one question:
**what is in this file?** It opens the container, reads the stream headers and the
container tags, and closes it. It decodes nothing, seeks nowhere, and holds
nothing open — which is what makes it cheap enough to run over a folder of
forty imports without a progress dialog.

What it is *not*: this module does not decode frames, resample audio or build
proxies. Those are `MediaDecoder`, `AudioResampler` and a scheduler job, and they
arrive with the render and preview slices. A prober that also decoded would be
the wrong shape for import, and import is the only thing that needs one today.

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

from fractions import Fraction
from typing import TYPE_CHECKING, Any, Final

import av

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import (
    AssetKind,
    AudioStreamInfo,
    ColourMeta,
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import MediaErrorCode

if TYPE_CHECKING:
    from collections.abc import Mapping

__all__ = ["AV_TIME_BASE", "PyAVProber"]

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
                return ok(self._describe(container, path))
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
            # Reported instead of a summary, not alongside one: a description of
            # a file we cannot decode would be believed.
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
