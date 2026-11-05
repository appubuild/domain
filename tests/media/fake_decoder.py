"""A fake decoder for tests that need pictures but not FFmpeg.

The frame-source pool is a performance component: what it is *for* is avoiding
seeks, and the only way to test that is to count them. A real PyAV decoder
cannot be asked how many times it seeked, so this can — and it is why the fake
exists rather than being a laziness.

It also mirrors the three behaviours of the port that matter, and only those:

* **A frame's content identifies it.** Frame *n* is a flat grey of value
  ``n % 256``, so a test can assert "this is frame 7" without comparing arrays
  against a fixture, and a bug that serves the wrong frame is visible as the
  wrong number.
* **Seeks are counted the way a real decoder incurs them.** ``frames(start)``
  costs one seek unless it continues the previous read; ``frame_at`` always
  costs one. A test that renders thirty frames and sees thirty seeks has found
  the exact bug the pool exists to prevent.
* **Failure is a value, not an exception.** A file that will not open returns
  ``Err``; a stream that is damaged at frame *n* yields nothing from *n* on and
  latches ``DECODE_FAILED``; a file with no video stream returns no video
  source. All three are states of media, and none of them may raise out of a
  render.

Nothing here is shipped, and nothing here is a fallback: it is a test double
for one port, kept beside the other generated media in ``tests/media/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from nova_studio.core.errors import NovaError
from nova_studio.core.result import err, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import (
    AssetKind,
    ColourMeta,
    FrameBuffer,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import MediaErrorCode

__all__ = ["FakeClip", "FakeDecoder", "FakeMedia", "FakeVideoSource"]


def _decode_failed(reason: str, *, position: object = None) -> NovaError:
    return NovaError(
        MediaErrorCode.DECODE_FAILED,
        "this file could not be decoded",
        details={"reason": reason, "position": position},
    )


@dataclass(frozen=True, slots=True)
class FakeClip:
    """What one pretend file contains.

    Args:
        width: Frame width, in pixels.
        height: Frame height, in pixels.
        frame_count: How many frames it has.
        keyframes: Frames that can be decoded without their neighbours.
        damaged_from: The first frame that fails to decode, or ``None``.
        error: An error to return from ``open`` instead of opening at all.
        video_streams: How many video streams the file reports (``0`` makes a
            file with no picture, which is a real state of a real file).
    """

    width: int = 8
    height: int = 6
    frame_count: int = 30
    keyframes: tuple[int, ...] = (0, 10, 20)
    damaged_from: int | None = None
    error: NovaError | None = None
    video_streams: int = 1


class FakeVideoSource:
    """One pretend video stream, counting its own seeks."""

    __slots__ = ("_clip", "_closed", "_error", "_position", "_reads", "seeks")

    def __init__(self, clip: FakeClip) -> None:
        self._clip = clip
        self._position: int | None = None
        self._error: NovaError | None = None
        self._closed = False
        self.seeks = 0
        self._reads = 0

    # -- the port ---------------------------------------------------------

    def info(self) -> VideoStreamInfo:
        return VideoStreamInfo(
            codec_name="fake",
            width=self._clip.width,
            height=self._clip.height,
            timebase=Timebase(num=30, den=1),
            frame_count=self._clip.frame_count,
            pixel_format="rgb24",
            colour=ColourMeta(),
        )

    def frame_count(self) -> int:
        return self._clip.frame_count

    def last_error(self) -> NovaError | None:
        return self._error

    def close(self) -> None:
        self._closed = True

    @property
    def is_closed(self) -> bool:
        return self._closed

    def keyframe_indices(self) -> tuple[int, ...]:
        return self._clip.keyframes

    def frames(self, start: int = 0, stop: int | None = None) -> Any:
        """Yield frames from ``start``, seeking only when it cannot continue."""
        self._error = None
        if self._closed:
            return
        if self._position is None or start != self._position:
            self.seeks += 1
        self._position = start
        self._reads += 1
        end = self._clip.frame_count if stop is None else min(stop, self._clip.frame_count)
        for index in range(start, end):
            if self._clip.damaged_from is not None and index >= self._clip.damaged_from:
                self._error = _decode_failed("damaged", position=index)
                return
            self._position = index + 1
            yield self._picture(index)

    def frame_at(self, index: int) -> FrameBuffer | None:
        """Decode one frame. Always costs a seek, as a real one would."""
        self._error = None
        if self._closed or index < 0 or index >= self._clip.frame_count:
            return None
        self.seeks += 1
        self._position = index + 1
        if self._clip.damaged_from is not None and index >= self._clip.damaged_from:
            self._error = _decode_failed("damaged", position=index)
            return None
        return self._picture(index)

    # -- internals --------------------------------------------------------

    def _picture(self, index: int) -> FrameBuffer:
        """Frame ``index``: a flat grey whose value *is* the frame number.

        ``% 256`` because a picture is uint8; a clip longer than 256 frames
        wraps, which is fine for anything a test needs to tell apart.
        """
        value = index % 256
        return FrameBuffer(
            pixels=np.full((self._clip.height, self._clip.width, 3), value, dtype=np.uint8)
        )


class FakeMedia:
    """A pretend opened file."""

    __slots__ = ("_clip", "_closed", "_sources", "path")

    def __init__(self, path: str, clip: FakeClip) -> None:
        self.path = path
        self._clip = clip
        self._sources: list[FakeVideoSource] = []
        self._closed = False

    def info(self) -> MediaInfo:
        return MediaInfo(
            kind=AssetKind.VIDEO,
            container_format="fake",
            duration_seconds=self._clip.frame_count / 30.0,
            video=(FakeVideoSource(self._clip).info(),),
        )

    def video(self, stream_index: int | None = None) -> FakeVideoSource | None:
        if self._clip.video_streams < 1:
            return None
        source = FakeVideoSource(self._clip)
        self._sources.append(source)
        return source

    def audio(self, stream_index: int | None = None) -> Any:
        return None

    def close(self) -> None:
        self._closed = True
        for source in self._sources:
            source.close()

    @property
    def is_closed(self) -> bool:
        return self._closed

    @property
    def sources(self) -> tuple[FakeVideoSource, ...]:
        return tuple(self._sources)


@dataclass(slots=True)
class FakeDecoder:
    """A pretend :class:`~nova_studio.ports.media.MediaDecoder`.

    Args:
        files: What each path contains.
    """

    files: dict[str, FakeClip] = field(default_factory=dict)
    opens: int = 0
    opened: tuple[FakeMedia, ...] = ()

    def with_file(self, path: str, **over: Any) -> FakeDecoder:
        """Add one file and return ``self``, for building a decoder in a line."""
        self.files[path] = FakeClip(**over)
        return self

    def open(self, path: str) -> Any:
        """Open one of the pretend files, or fail the way a real one would."""
        self.opens += 1
        clip = self.files.get(path)
        if clip is None:
            return err(
                NovaError(
                    MediaErrorCode.UNREADABLE,
                    "this file could not be opened",
                    details={"path": path},
                )
            )
        if clip.error is not None:
            return err(clip.error)
        media = FakeMedia(path, clip)
        self.opened = (*self.opened, media)
        return ok(media)

    @property
    def open_paths(self) -> tuple[str, ...]:
        return tuple(media.path for media in self.opened if not media.is_closed)

    @property
    def total_seeks(self) -> int:
        """Every seek every stream has made. The number a pool is judged on."""
        return sum(source.seeks for media in self.opened for source in media.sources)
