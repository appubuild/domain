from __future__ import annotations

import contextlib
import os
import uuid
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, TypeAlias

import cv2

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.result import err, ok
from nova_studio.ports.render import RenderErrorCode

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.result import Result
    from nova_studio.domain.media import FrameBuffer

#: What the render feature asks for, and what :func:`encoder_for` supplies.
#: A `Result`, because a refusal is a value in this codebase and never an
#: exception thrown across a layer (see `api/errors.py`).
FrameEncoder: TypeAlias = "Callable[[FrameBuffer], Result[bytes]]"

#: What the media feature asks for: "put this picture at this path, and tell me
#: how many bytes it cost". One callable rather than an encoder plus a writer
#: because the two are one act here — a still that is encoded but not written
#: is not a thumbnail, and the caller that would have to remember to write it
#: is a job body running in another process.
StillSink: TypeAlias = "Callable[[FrameBuffer, str], Result[int]]"

__all__ = [
    "DEFAULT_QUALITY",
    "FrameEncoder",
    "FrameFormat",
    "StillSink",
    "encode_frame",
    "encoder_for",
    "media_type_for",
    "still_sink",
    "write_still",
]


class FrameFormat(StrEnum):
    """The still-image formats a preview can be sent as.

    Chosen for what they are *for*, not for what a browser supports: a preview
    panel wants speed above all, and a frame the user has already scrolled past
    is worth nothing.
    """

    #: The default. Lossy, tiny, fast, and universally understood — a preview is
    #: a picture somebody is scrubbing through, not a deliverable.
    JPEG = "jpeg"
    #: Lossless and slow: for a frame the user is *studying* — a focus check, a
    #: colour decision — where compression artefacts would be the thing they see.
    PNG = "png"
    #: Smaller than JPEG at the same quality and supports alpha, at the cost of
    #: encode time. The right choice for a panel over a slow link; the wrong one
    #: for a panel on the same machine.
    WEBP = "webp"


#: The default JPEG quality. Above about 85 the bytes double for a difference
#: nobody can see while the image is moving; below 70 the compression blocks
#: start to look like detail in the footage.
DEFAULT_QUALITY: Final[int] = 80

_EXTENSION: Final[dict[FrameFormat, str]] = {
    FrameFormat.JPEG: ".jpg",
    FrameFormat.PNG: ".png",
    FrameFormat.WEBP: ".webp",
}

_MEDIA_TYPE: Final[dict[FrameFormat, str]] = {
    FrameFormat.JPEG: "image/jpeg",
    FrameFormat.PNG: "image/png",
    FrameFormat.WEBP: "image/webp",
}

#: The `imwrite` constant each format tunes quality with. PNG is lossless and
#: tunes *compression* instead, on a 0-9 scale, so it is handled apart.
_QUALITY_FLAG: Final[dict[FrameFormat, int]] = {
    FrameFormat.JPEG: int(cv2.IMWRITE_JPEG_QUALITY),
    FrameFormat.WEBP: int(cv2.IMWRITE_WEBP_QUALITY),
}


def media_type_for(format: FrameFormat) -> str:
    """The `Content-Type` for one format.

    Here rather than in the API layer because it is a property of the encoding,
    and a router that spelled it out would be one edit away from lying.
    """
    return _MEDIA_TYPE[format]


def encode_frame(
    buffer: FrameBuffer,
    *,
    format: FrameFormat = FrameFormat.JPEG,
    quality: int = DEFAULT_QUALITY,
) -> Result[bytes]:
    """Encode one frame as one still image.

    Args:
        buffer: The picture. One, three or four channels, any dtype OpenCV
            accepts; the compositor hands over `uint8`.
        format: Which still-image format.
        quality: 0-100 for JPEG and WebP, and the PNG compression level scaled
            onto 0-9 when PNG is asked for. Clamped, not refused: a caller
            reading a quality slider is not making a request that can be
            invalid.

    Returns:
        The encoded bytes, or `Err` carrying
        :attr:`RenderErrorCode.ENCODE_FAILED` when the encoder refused the
        frame. A refusal is a value because this sits under an HTTP handler,
        and the handler's job is to turn values into responses.

    Raises:
        NovaInvariantError: if the buffer has two channels — the one shape no
            image format can represent, and therefore a bug in whoever built it.
    """
    pixels: Any = buffer.pixels
    channels = pixels.shape[2] if pixels.ndim == 3 else 1
    if channels == 2:
        raise NovaInvariantError(
            f"a frame must have 1, 3 or 4 channels to be encoded, got {channels}"
        )
    if channels == 3:
        pixels = cv2.cvtColor(pixels, cv2.COLOR_RGB2BGR)
    elif channels == 4:
        # JPEG has no alpha, and a frame has none to carry: the compositor
        # flattened it. PNG and WebP could keep it, and do not, because a
        # preview that showed transparency would be showing something the
        # export never will.
        pixels = cv2.cvtColor(pixels, cv2.COLOR_RGBA2BGR)

    if format is FrameFormat.PNG:
        level = _clamp(quality, 0, 100) * 9 // 100
        params = [int(cv2.IMWRITE_PNG_COMPRESSION), level]
    else:
        params = [_QUALITY_FLAG[format], _clamp(quality, 0, 100)]

    encoded, serialised = cv2.imencode(_EXTENSION[format], pixels, params)
    if not encoded or serialised is None:
        return err(
            NovaError(
                RenderErrorCode.ENCODE_FAILED,
                "this frame could not be encoded for preview",
                details={"format": str(format)},
            )
        )
    return ok(serialised.tobytes())


def write_still(
    buffer: FrameBuffer,
    path: str,
    *,
    format: FrameFormat = FrameFormat.JPEG,
    quality: int = DEFAULT_QUALITY,
) -> Result[int]:
    """Encode one frame as one image and leave it at ``path``.

    The write is **atomic**: the bytes are staged beside the target under a
    unique name and renamed into place. A thumbnail is read by a panel that
    opens whatever it finds, so a half-written JPEG is not a missing thumbnail
    — it is a broken one, and a broken one is served.

    Returns the number of bytes written, which is what the cache index wants to
    record: the cost of keeping this artefact, as the disk actually measured
    it, not as an estimate.

    Raises:
        NovaInvariantError: If the frame has two channels — the one shape no
            image format can represent.
    """
    encoded = encode_frame(buffer, format=format, quality=quality)
    if encoded.is_err():
        return err(encoded.unwrap_err())
    data = encoded.unwrap()

    destination = Path(path)
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Unique per write, not per process: two thumbnail jobs for the same
        # asset in the same session would otherwise race to rename the same
        # staging file, and one of the renames would fail on a file the other
        # had already moved.
        staged = destination.parent / f".{destination.name}.{os.getpid()}.{uuid.uuid4().hex}.part"
        with staged.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        staged.replace(destination)
    except OSError as error:
        with contextlib.suppress(OSError):
            staged.unlink(missing_ok=True)
        return err(
            NovaError(
                RenderErrorCode.SINK_UNWRITABLE,
                f"could not write the still image at {path}: {error}",
                details={"path": path},
            )
        )
    return ok(len(data))


def still_sink(
    *,
    format: FrameFormat = FrameFormat.JPEG,
    quality: int = DEFAULT_QUALITY,
) -> StillSink:
    """A :data:`StillSink` closed over one format and one quality.

    The media feature takes a *factory* for one of these rather than a bound
    encoder, because a job body is pickled and sent to a worker process: what
    crosses the boundary is ``functools.partial(still_sink, quality=78)``,
    which is a reference to this function and an argument, not a closure.
    """

    def sink(buffer: FrameBuffer, path: str) -> Result[int]:
        return write_still(buffer, path, format=format, quality=quality)

    return sink


def encoder_for(
    format: FrameFormat = FrameFormat.JPEG,
    *,
    quality: int = DEFAULT_QUALITY,
) -> FrameEncoder:
    """A one-argument encoder closed over its format and quality.

    The render feature asks for `Callable[[FrameBuffer], bytes]`; this is how
    the composition root supplies one without the feature knowing that OpenCV
    was involved. The result is a plain function, so a test can pass a lambda
    and assert on what the renderer did rather than on what a codec produced.
    """

    def encode(buffer: FrameBuffer) -> Result[bytes]:
        return encode_frame(buffer, format=format, quality=quality)

    return encode


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))
