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
    AudioBuffer,
    AudioStreamInfo,
    ColourMeta,
    FrameBuffer,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import MediaErrorCode

__all__ = [
    "FakeAudioSource",
    "FakeClip",
    "FakeDecoder",
    "FakeMedia",
    "FakeVideoSource",
]


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
        sample_rate: The soundtrack's rate. ``0`` means no soundtrack at all,
            which is what a silent camera file or a rendered picture sequence
            reports, and what a mixer has to read as "nothing to mix" rather
            than "nothing came back".
        channels: How many channels the soundtrack has.
        sample_count: How long the soundtrack is. Defaults to however long the
            frames last at 30 fps, because that is what a real file recorded
            alongside these pictures would be.
        audio_rate_divisor: The period of the generated tone, in samples. Small
            enough that a one-block mix differs from the next, large enough
            that a block never starts and ends at zero.
    """

    width: int = 8
    height: int = 6
    frame_count: int = 30
    keyframes: tuple[int, ...] = (0, 10, 20)
    damaged_from: int | None = None
    error: NovaError | None = None
    video_streams: int = 1
    sample_rate: int = 0
    channels: int = 2
    sample_count: int = -1
    audio_rate_divisor: int = 1600

    @property
    def has_audio(self) -> bool:
        return self.sample_rate > 0

    @property
    def audio_samples(self) -> int:
        """How many samples the soundtrack runs for."""
        if self.sample_count >= 0:
            return self.sample_count
        return (self.frame_count * self.sample_rate) // 30


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


class FakeAudioSource:
    """One pretend soundtrack, generated rather than stored.

    Its sample ``n`` is ``sin(n / divisor)``, which is two things at once: a
    signal that differs measurably at every position, so a test can tell
    whether a mix read sample 0 or sample 4096, and a signal that never lands
    on ``0.0`` at a block boundary, so "is this gap silent?" stays a question
    a test can ask honestly.

    It honours the port's contract exactly — the first sample yielded is
    ``start``, and the total is at most ``count`` — because a fake that is
    looser than the port is a fake that hides the bug the contract exists to
    prevent.
    """

    __slots__ = ("_channels", "_clip", "_closed", "_error", "_rate", "reads")

    def __init__(self, clip: FakeClip) -> None:
        self._clip = clip
        self._rate = clip.sample_rate
        self._channels = clip.channels
        self._error: NovaError | None = None
        self._closed = False
        #: Every ``(start, count)`` asked for, which is the only evidence a
        #: test has that a mixer read each clip once, in order, and from the
        #: offset it should have.
        self.reads: list[tuple[int, int]] = []

    def info(self) -> AudioStreamInfo:
        return AudioStreamInfo(
            codec_name="fake",
            sample_rate=self._rate,
            channels=self._channels,
            sample_count=self._clip.audio_samples,
            sample_format="fltp",
        )

    def last_error(self) -> NovaError | None:
        return self._error

    def close(self) -> None:
        self._closed = True

    @property
    def is_closed(self) -> bool:
        return self._closed

    def samples(self, start: int = 0, count: int | None = None) -> Any:
        self._error = None
        if self._closed:
            return
        available = max(0, self._clip.audio_samples - start)
        wanted = available if count is None else min(count, available)
        self.reads.append((start, wanted))
        if wanted == 0:
            return
        positions = np.arange(start, start + wanted, dtype=np.float64)
        signal = np.sin(positions / self._clip.audio_rate_divisor)
        block = np.repeat(signal[:, None], self._channels, axis=1)
        yield AudioBuffer(samples=block.astype(np.float32), sample_rate=self._rate)


class FakeMedia:
    """A pretend opened file."""

    __slots__ = ("_audio", "_clip", "_closed", "_sources", "path")

    def __init__(self, path: str, clip: FakeClip) -> None:
        self.path = path
        self._clip = clip
        self._sources: list[FakeVideoSource] = []
        self._audio: FakeAudioSource | None = None
        self._closed = False

    def info(self) -> MediaInfo:
        video = () if self._clip.video_streams < 1 else (FakeVideoSource(self._clip).info(),)
        audio = () if not self._clip.has_audio else (FakeAudioSource(self._clip).info(),)
        # The probe's verdict, not the suffix's: a file with no picture but a
        # soundtrack *is* audio, and one with neither is what a prober reports
        # as unknown rather than guessing at.
        if not video and not audio:
            kind = AssetKind.UNKNOWN
        elif not video:
            kind = AssetKind.AUDIO
        else:
            kind = AssetKind.VIDEO
        return MediaInfo(
            kind=kind,
            container_format="fake",
            duration_seconds=self._clip.frame_count / 30.0,
            video=video,
            audio=audio,
        )

    def video(self, stream_index: int | None = None) -> FakeVideoSource | None:
        if self._clip.video_streams < 1:
            return None
        source = FakeVideoSource(self._clip)
        self._sources.append(source)
        return source

    def audio(self, stream_index: int | None = None) -> Any:
        """The soundtrack, or ``None`` when the file has none.

        One per file and held, because that is what a real adapter does: two
        handles on one container means two seeks of a file that is already
        open.
        """
        if not self._clip.has_audio:
            return None
        if self._audio is None:
            self._audio = FakeAudioSource(self._clip)
        return self._audio

    def close(self) -> None:
        self._closed = True
        for source in self._sources:
            source.close()
        if self._audio is not None:
            self._audio.close()

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
