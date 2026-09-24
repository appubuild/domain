"""L2 port — media: how footage is read without naming a library.

Everything the editor does begins with a file: probe it, decode frames from it,
pull audio out of it, resample that audio to the project rate.  Those are five
different capabilities with five different lifetimes, so this module declares
six protocols — the five capabilities plus the handle a decoder hands back —
narrowest first, in the same style as ``clock.py`` and ``ident.py``:

``MediaProber``
    One call, ``probe(path)`` — what the file says about itself.  Used at import,
    on relink, and when a cached summary is missing.  Stateless; one instance can
    serve the whole application.
``MediaDecoder``
    ``open(path)`` → a :class:`DecodedMedia` handle.  Opening a container costs
    ~1–10 ms against a 16.7 ms frame budget, which is why the *handle* is
    separate from the decoder: a pool keeps one open per asset instead of
    reopening per frame (ADR-0007 §5).
``VideoFrameSource`` / ``AudioSampleSource``
    The streams inside an open file.  A consumer that only needs frames takes
    the frame source, not the handle, so a test double has to fake less.
``AudioResampler``
    Rate and channel conversion, because that is libswresample's job and no
    ring inside ``infra`` may name it.

Why these are ports and not concrete classes
--------------------------------------------
Two plausible implementations exist for nearly all of them (PyAV in-process and
an FFmpeg CLI subprocess — ADR-0007 §1–3), and every one of them performs I/O.
That is the whole test for "does this deserve a port?".  The payoff is that the
render engine can be unit-tested against a synthetic frame source with no FFmpeg
present, and that swapping backends is one adapter plus one container binding.

Contract rules an adapter must honour
-------------------------------------
1. **Failures are values, not exceptions.**  The two methods that open a file
   return ``Result[...]``; only a bug raises.  A failure *during* reading cannot
   travel in the iterator, so it is latched on the source and read once via
   ``last_error()``.  The codes are :class:`MediaErrorCode`, so a user sees
   "this codec is not supported" rather than a traceback.
2. **Positions are integers.**  Frames for video, samples for audio (ADR-0006).
   No method takes seconds: the caller converts with an explicit rounding mode.
3. **Sequencing is the fast path.**  ``frames()`` / ``samples()`` stream
   forward; backwards or sparse access via ``frame_at()`` may cost a whole GOP
   of decoding, and an adapter is allowed to seek to the preceding keyframe and
   decode forward to the target.  Callers that want scrubbing performance ask
   for it deliberately, and :meth:`VideoFrameSource.keyframe_indices` tells them
   where the cheap landing spots are.
4. **Handles are closed.**  A source holds a decoder, and decoders hold memory
   the OS does not reclaim for us.  Every protocol carries ``close()``; a pool
   owns the lifecycle.
5. **No third-party types.**  Frames are :class:`~nova_studio.domain.media.FrameBuffer`
   and audio is :class:`~nova_studio.domain.media.AudioBuffer`, both from
   ``domain`` — the one place allowed to name ``numpy`` (ADR-0002 rule 2).

Not here, on purpose: encoding and capability probing belong to
``ports/render.py`` (``NS-MEDIA-4002``, the missing-encoder code ADR-0007 §7
names, is defined there); thumbnails and file watching belong to
``ports/filesystem.py``.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from nova_studio.core import NovaError, Result
    from nova_studio.domain.media import (
        AudioBuffer,
        AudioStreamInfo,
        FrameBuffer,
        MediaInfo,
        VideoStreamInfo,
    )

__all__ = [
    "AudioResampler",
    "AudioSampleSource",
    "DecodedMedia",
    "MediaDecoder",
    "MediaErrorCode",
    "MediaProber",
    "VideoFrameSource",
]


class MediaErrorCode(StrEnum):
    """The codes an adapter may return in the ``Err`` half of a ``Result``.

    Declared here, next to the contract that defines when each is produced, so
    that a reader finds the vocabulary in one place and ``infra`` never
    invents a spelling.  Codes are stable strings because the frontend maps
    them to localised messages (ARCHITECTURE.md §5.5).

    ``NS-MEDIA-4002`` is deliberately absent: ADR-0007 §7 assigns it to a
    missing *encoder*, which is the render port's concern.
    """

    #: Path does not exist, is not readable, or is not a media file at all.
    UNREADABLE = "NS-MEDIA-4001"
    #: The container or codec is understood but no decoder is available in this
    #: build — the user-facing remedy is "install/enable X or use the CLI
    #: backend", not "try again".
    UNSUPPORTED = "NS-MEDIA-4003"
    #: The file opened and then failed mid-stream: a truncated download, bit
    #: rot, a decode error at a specific timestamp.  Reported through
    #: :meth:`VideoFrameSource.last_error` / :meth:`AudioSampleSource.last_error`
    #: because an iterator has no ``Result`` channel; frames already emitted
    #: stay valid and the error names the position.
    DECODE_FAILED = "NS-MEDIA-4004"


@runtime_checkable
class MediaProber(Protocol):
    """Read what a file says about itself, without decoding any of it.

    Implementations are expected to be cheap enough to call on a folder of
    imports (one container open, no frame decode) and are safe to share across
    threads: nothing here mutates state.
    """

    def probe(self, path: str) -> Result[MediaInfo]:
        """Return the probe summary for ``path``.

        Args:
            path: Absolute path as recorded on the asset.

        Returns:
            ``Ok(MediaInfo)``, or ``Err`` carrying :attr:`MediaErrorCode.UNREADABLE`
            when the file cannot be opened and :attr:`MediaErrorCode.UNSUPPORTED`
            when no decoder in this build can read it — the difference matters,
            because one is the user's problem and the other is ours.
        """
        ...


@runtime_checkable
class VideoFrameSource(Protocol):
    """One decoded video stream: frames in timeline order.

    Frames are always in decode order and always tagged with the colour they
    were decoded as (ADR-0007 §6); no conversion happens here.
    """

    def info(self) -> VideoStreamInfo:
        """The stream description this source decodes."""
        ...

    def frame_count(self) -> int:
        """How many frames the stream has, or ``0`` when the count is unknown.

        An unknown count is real, not an error: a stream being written, or a
        container with no index.  Callers iterate until exhaustion rather than
        trusting this number as a bound.
        """
        ...

    def frame_at(self, index: int) -> FrameBuffer | None:
        """Decode one frame, or return ``None`` when no frame came back.

        Two different things produce ``None``, and :meth:`last_error` tells them
        apart: running past the last frame is normal, while a latched error
        means the frame existed and could not be decoded.

        Random access is allowed to cost a full GOP: an adapter may seek to the
        preceding keyframe and decode forward.  Callers scrubbing frame by frame
        should use :meth:`frames` instead and let the adapter pipeline.
        """
        ...

    def frames(self, start: int = 0, stop: int | None = None) -> Iterator[FrameBuffer]:
        """Yield frames from ``start`` up to but excluding ``stop``.

        ``stop=None`` means "to the end of the stream".  The iterator is lazy:
        an adapter decodes ahead only as far as it chooses, and abandoning it
        (``break``, generator close) must not leak a decoder.

        A decode failure *ends* the iteration rather than raising out of it —
        the hot path allocates one ``Result`` per frame otherwise, for a
        condition that occurs once a year.  The caller checks
        :meth:`last_error` once after the loop.
        """
        ...

    def keyframe_indices(self) -> Sequence[int]:
        """Frame numbers that can be decoded without decoding their neighbours.

        The scrubber and the frame-source pool use this to choose seek targets.
        An adapter may return an empty sequence when the container exposes no
        index — :meth:`frame_at` stays correct, just slower — but must never
        fabricate one.
        """
        ...

    def last_error(self) -> NovaError | None:
        """The failure that ended the last read, or ``None`` if it ended cleanly.

        Latched until the next read begins, so a consumer that drives the loop
        to exhaustion and then asks once cannot miss it.  This is the iterator's
        error channel: the code is :attr:`MediaErrorCode.DECODE_FAILED` and
        ``details`` names the position, which is what a render job puts in its
        ``Err`` and what the UI shows as "this clip is damaged at 00:03:12".
        """
        ...

    def close(self) -> None:
        """Release the decoder and everything it owns.  Idempotent."""
        ...


@runtime_checkable
class AudioSampleSource(Protocol):
    """One decoded audio stream: blocks of samples in timeline order.

    Blocks rather than single samples, because that is what a decoder produces:
    an AAC frame is 1024 samples, an Opus frame 960, and pretending otherwise
    would mean a per-sample call straight into libavcodec.
    """

    def info(self) -> AudioStreamInfo:
        """The stream description this source decodes."""
        ...

    def sample_count(self) -> int:
        """Total samples the stream has, or ``0`` when unknown."""
        ...

    def samples(self, start: int = 0, count: int | None = None) -> Iterator[AudioBuffer]:
        """Yield blocks of samples from ``start``.

        ``count`` is a maximum number of *samples* to yield across all blocks,
        not a block count; a block is never split to land exactly on it.  The
        first block may start slightly before ``start`` when the decoder must
        begin at a packet boundary — the caller trims, it does not assume.
        """
        ...

    def last_error(self) -> NovaError | None:
        """The failure that ended the last read, as on the video side."""
        ...

    def close(self) -> None:
        """Release the decoder.  Idempotent."""
        ...


@runtime_checkable
class DecodedMedia(Protocol):
    """An open media file: the handle a :class:`MediaDecoder` hands back.

    One of these per asset, pooled and closed on eviction (ADR-0007 §5).  It is
    a handle, not a value: it owns native resources, so it is passed around by
    reference and closed exactly once.
    """

    def info(self) -> MediaInfo:
        """The probe summary of the file as opened."""
        ...

    def video(self, stream_index: int | None = None) -> VideoFrameSource | None:
        """Open a video stream, or return ``None`` when there is none to open.

        Args:
            stream_index: Container stream index.  ``None`` picks the first
                video stream — the one :meth:`MediaInfo.primary_video` returns.

        ``None`` covers both "this file has no video" and "stream 3 is gone",
        because the caller already holds the probe summary and can tell them
        apart with :meth:`MediaInfo.stream` — which is also where a helpful
        message ("this file has no picture") comes from.  Asking for a stream
        the probe never listed is a caller bug and is not a media error.
        """
        ...

    def audio(self, stream_index: int | None = None) -> AudioSampleSource | None:
        """Open an audio stream, or return ``None`` when the file has none."""
        ...

    def close(self) -> None:
        """Close every stream opened from this handle, then the container.

        Idempotent: a pooled handle may be closed by the pool and by a
        ``finally`` block in the same call stack.
        """
        ...


@runtime_checkable
class MediaDecoder(Protocol):
    """Open a media file for decoding.  The factory behind the handle."""

    def open(self, path: str) -> Result[DecodedMedia]:
        """Open ``path`` and return the handle, or the reason it could not be.

        This is the only call in the module that must be assumed to fail often:
        files move, drives unmount, a project opens on a machine without the
        codec.  Adapters report those as ``Err`` with
        :attr:`MediaErrorCode.UNREADABLE` or :attr:`MediaErrorCode.UNSUPPORTED`
        and never raise.
        """
        ...


@runtime_checkable
class AudioResampler(Protocol):
    """Convert decoded audio to the project's rate and channel count.

    Deliberately its own port rather than a method on the source: resampling is
    stateful (a resampler must be flushed, and its delay means output length is
    not a pure function of input length), it is needed everywhere audio is
    mixed or exported, and libswresample is exactly the dependency this ring
    exists to hide.
    """

    def resample(self, buffer: AudioBuffer, *, sample_rate: int, channels: int) -> AudioBuffer:
        """Return ``buffer`` converted to ``sample_rate`` and ``channels``.

        Mono → stereo duplicates; stereo → mono averages.  Sample-rate
        conversion is not sample-exact: the result may be a few samples longer
        or shorter than the input scaled by the rate ratio, so callers must
        read :attr:`~nova_studio.domain.media.AudioBuffer.frame_count` from what
        they get back instead of computing it.
        """
        ...
