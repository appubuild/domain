"""The frame source pool: turning a plan's decode requests into pictures.

A `FramePlan` says *which* pictures a frame needs. Getting them is this
module's job, and it is the one place in the render path where cost is measured
in seeks rather than in arithmetic.

**Why a pool at all.** Decoding a frame is cheap; getting *to* a frame is not.
An inter-frame codec stores a picture as a difference from its neighbours, so
frame *n* can only be produced by decoding the keyframe before it and every
frame between. Asking a decoder for one frame at a time is therefore O(GOP) per
frame — a 30-frame GOP makes a sequential render thirty times more expensive
than it should be, and scrubbing feels like it is dragging.

So the pool does three things a caller should not have to think about:

1. **It reads forward.** A render walks a clip forwards, so each open stream
   keeps a live sequential read and the next frame is taken from it. One seek
   begins a run; the rest of the run costs nothing. A jump abandons the read and
   starts a new one — which is the honest price of a jump.
2. **It holds a bounded number of decoders.** A project may name fifty assets; a
   frame needs at most a handful. Open handles are kept least-recently-used and
   the oldest is released when the pool is full, because an open decoder is a
   file handle and a demuxer buffer, and a machine with fifty of them open is a
   machine that will not open a fifty-first.
3. **It caches what it decoded.** Scrubbing back and forth, or a UI that
   repaints, asks for the same frames again. The cache is bounded in *bytes*,
   not in entries: a 4K frame is thirty times a 720p one, and a cache of "64
   frames" is either a rounding error or a third of the machine's memory
   depending on the project.

**What it refuses to know.** Nothing here opens a file, chooses between an
original and a proxy, or knows what an asset is. Two injected collaborators do
that: a `MediaDecoder` (a port) and a *resolver* — a function from
`(asset_id, source)` to a path, supplied by the media layer, because the render
feature may not import it (ADR-0002 rule 4). Which is also why a test can
resolve to whatever it likes and count the seeks.

**Failure is a gap, not an exception.** An asset whose file is missing, or a
stream that fails mid-decode, produces *fewer pictures* — the compositor skips
the layer rather than drawing a black rectangle over everything beneath it
(ADR-0015 rule 3) — and a latched :class:`NovaError` the caller can report as
"three frames used an offline file". A render is not the place to discover that
an exception is the wrong shape for a missing file.

Thread safety: none. A pool is owned by one render; two threads sharing one
would share the sequential reads, which is exactly the state that must not be
shared.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypeAlias

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.ports.media import MediaErrorCode

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator, Sequence

    from nova_studio.domain.media import FrameBuffer, VideoStreamInfo
    from nova_studio.ports.media import DecodedMedia, MediaDecoder, VideoFrameSource
    from nova_studio.services.render import DecodeRequest

__all__ = [
    "DEFAULT_CACHE_BYTES",
    "DEFAULT_OPEN_SOURCES",
    "FrameSourcePool",
    "PoolStats",
    "SourceResolver",
]

#: How many decoders a pool keeps open at once. A frame is composited from a
#: handful of layers; more than this is not a cache, it is a leak with a budget.
DEFAULT_OPEN_SOURCES: int = 4

#: How much decoded picture a pool holds on to, in bytes. 128 MiB is eight 4K
#: frames or a few hundred at proxy scale — enough to make scrubbing feel
#: instant, small enough that it is never the reason a render failed.
DEFAULT_CACHE_BYTES: int = 128 * 1024 * 1024

#: ``(asset_id, source) -> path``, or ``None`` when that copy is not available.
#: Supplied by the media layer: which file *is* the proxy is a media question,
#: and this feature may not ask it (ADR-0002 rule 4).
SourceResolver: TypeAlias = "Callable[[str, str], str | None]"


@dataclass(frozen=True, slots=True)
class PoolStats:
    """What the pool did. Counts, because that is what a perf report wants.

    `seeks` is the number worth watching: it is how many times the pool had to
    start a read rather than continue one. A sequential render of a clip should
    report one seek per contiguous run, and a report of one seek per frame is a
    bug in the caller's frame order rather than in the codec.
    """

    opens: int = 0
    closes: int = 0
    seeks: int = 0
    hits: int = 0
    misses: int = 0
    gaps: int = 0

    def __add__(self, other: PoolStats) -> PoolStats:
        return PoolStats(
            opens=self.opens + other.opens,
            closes=self.closes + other.closes,
            seeks=self.seeks + other.seeks,
            hits=self.hits + other.hits,
            misses=self.misses + other.misses,
            gaps=self.gaps + other.gaps,
        )


class _Stream:
    """One open stream, and the sequential read it may be in the middle of.

    The read is the whole point: `frame_at` on a decoder is allowed to cost a
    GOP, so this keeps the generator the port hands back and pulls from it. A
    request for the frame *after* the last one taken is free; anything else
    abandons the read and starts again, which is the honest price of a jump.
    """

    __slots__ = ("_handle", "_media", "_next_index", "_read", "path", "stream")

    def __init__(self, media: DecodedMedia, handle: VideoFrameSource, path: str) -> None:
        self._media = media
        self._handle = handle
        self.path = path
        self.stream: VideoStreamInfo = handle.info()
        self._read: Iterator[FrameBuffer] | None = None
        self._next_index: int | None = None

    def seek_cost_of(self, index: int) -> int:
        """How many seeks serving ``index`` from here would cost."""
        return 0 if self._read is not None and index == self._next_index else 1

    def picture_at(self, index: int) -> FrameBuffer | None:
        """The picture at ``index``, or ``None`` when the stream has none."""
        if self._read is None or index != self._next_index:
            self._abandon()
            self._read = self._handle.frames(index, None)
            self._next_index = index
        try:
            picture = next(self._read)
        except StopIteration:
            self._abandon()
            return None
        self._next_index = index + 1
        return picture

    def last_error(self) -> NovaError | None:
        return self._handle.last_error()

    def keyframes(self) -> Sequence[int]:
        return self._handle.keyframe_indices()

    def close(self) -> None:
        self._abandon()
        self._handle.close()
        self._media.close()

    def _abandon(self) -> None:
        """Drop an in-flight read.

        A generator that is never closed leaves the demuxer wherever it
        stopped, which for a seek-heavy scrub is a file handle and a buffer
        held for no reason. `close()` on a generator runs its `finally`.
        """
        if self._read is not None:
            # `typing.Iterator` has no `close`; a generator does, and every
            # implementation of the port hands back a generator.
            close = getattr(self._read, "close", None)
            if callable(close):
                close()
            self._read = None
            self._next_index = None


class FrameSourcePool:
    """Serve :class:`DecodeRequest` s as pictures, with bounded everything."""

    __slots__ = (
        "_cache",
        "_cache_bytes",
        "_cache_used",
        "_capacity",
        "_decoder",
        "_errors",
        "_missing",
        "_open",
        "_resolve",
        "_seen",
        "_stats",
    )

    def __init__(
        self,
        decoder: MediaDecoder,
        resolve: SourceResolver,
        *,
        capacity: int = DEFAULT_OPEN_SOURCES,
        cache_bytes: int = DEFAULT_CACHE_BYTES,
    ) -> None:
        """Args:
        decoder: How to open a file. A port, so a test need not have FFmpeg.
        resolve: ``(asset_id, source) -> path``, or ``None`` for a copy that
            is not there — an offline asset, or an original whose proxy has
            not been built yet.
        capacity: How many decoders to keep open.
        cache_bytes: How much decoded picture to hold on to, in bytes.

        Raises:
            NovaInvariantError: if ``capacity`` or ``cache_bytes`` is not
                positive — a pool that can hold nothing is a caller's bug.
        """
        if capacity < 1:
            raise NovaInvariantError(f"capacity must be at least 1, got {capacity}")
        if cache_bytes < 1:
            raise NovaInvariantError(f"cache_bytes must be at least 1, got {cache_bytes}")
        self._decoder = decoder
        self._resolve = resolve
        self._capacity = capacity
        self._cache_bytes = cache_bytes
        self._open: OrderedDict[tuple[str, str], _Stream] = OrderedDict()
        self._cache: OrderedDict[tuple[str, int, str], FrameBuffer] = OrderedDict()
        self._cache_used = 0
        self._missing: set[tuple[str, str]] = set()
        self._errors: list[NovaError] = []
        self._seen: set[tuple[str, str]] = set()
        self._stats = PoolStats()

    # -- the API ----------------------------------------------------------

    def pictures(
        self, requests: Iterable[DecodeRequest]
    ) -> dict[tuple[str, int, str], FrameBuffer]:
        """Decode what can be decoded, keyed by :attr:`DecodeRequest.key`.

        Requests are served in the order given, which matters: a caller that
        sorts them per frame by asset keeps every stream sequential, and one
        that does not pays a seek. Missing files and failed decodes simply
        produce no entry — the compositor skips the layer — and are reported by
        :meth:`errors` and :meth:`stats` instead.

        Args:
            requests: What to decode, usually ``plan.decodes()``.

        Returns:
            A mapping from ``DecodeRequest.key`` to the decoded picture. Never
            raises for a file that is absent or damaged.
        """
        found: dict[tuple[str, int, str], FrameBuffer] = {}
        for request in requests:
            key = request.key
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                # The asset counts as used even though nothing was decoded:
                # a caller still asking about it is a caller that will ask
                # again, and that is what keeps its decoder open.
                handle = self._open.get((request.asset_id, request.source))
                if handle is not None:
                    self._open.move_to_end((request.asset_id, request.source))
                self._stats = self._stats + PoolStats(hits=1)
                found[key] = cached
                continue
            picture = self._decode(request)
            if picture is not None:
                found[key] = picture
        return found

    def prefetch(self, requests: Iterable[DecodeRequest]) -> None:
        """Decode now, keep, and answer nothing.

        Warming is the difference between a scrub that stutters and one that
        does not: the frames are wanted soon and are cheaper in a batch than
        one at a time, because each stream is already open and reading
        forwards. Failures are recorded, never raised — a warm that could not
        warm is not an error, it is just a frame that will be slow.
        """
        for request in requests:
            if request.key not in self._cache:
                self._decode(request)

    def keyframes(self, asset_id: str, source: str) -> tuple[int, ...]:
        """The frames that can be decoded without their neighbours.

        Empty when the container has no index, which is a fact about the file
        and not a failure. The scrubber uses this to snap, and a caller that
        ignores it loses only speed.
        """
        stream = self._stream_for(asset_id, source)
        if stream is None:
            return ()
        return tuple(stream.keyframes())

    @property
    def stats(self) -> PoolStats:
        """What the pool has done so far."""
        return self._stats

    @property
    def cached_bytes(self) -> int:
        """How much decoded picture the pool is holding."""
        return self._cache_used

    @property
    def open_sources(self) -> int:
        """How many decoders are open right now."""
        return len(self._open)

    def errors(self) -> tuple[NovaError, ...]:
        """The failures so far, oldest first.

        Latched rather than raised: a render that meets a damaged file keeps
        going, because one bad frame in a two-hour export must not cost the
        other two hours — and because the caller is the only one who knows
        whether a gap is fatal.
        """
        return tuple(self._errors)

    def clear_cache(self) -> None:
        """Drop the decoded pictures but keep the decoders.

        What an edit does: the pictures on screen are of a timeline that no
        longer exists, and the next frame will ask for different ones.
        """
        self._cache.clear()
        self._cache_used = 0

    def close(self) -> None:
        """Release every decoder and every cached picture. Idempotent."""
        for stream in list(self._open.values()):
            stream.close()
            self._stats = self._stats + PoolStats(closes=1)
        self._open.clear()
        self._cache.clear()
        self._cache_used = 0

    def __enter__(self) -> FrameSourcePool:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # -- internals --------------------------------------------------------

    def _decode(self, request: DecodeRequest) -> FrameBuffer | None:
        """One request, from the cache, the live read, or a new one."""
        self._stats = self._stats + PoolStats(misses=1)
        stream = self._stream_for(request.asset_id, request.source)
        if stream is None:
            self._stats = self._stats + PoolStats(gaps=1)
            return None
        before = stream.seek_cost_of(request.source_frame)
        try:
            picture = stream.picture_at(request.source_frame)
        except (OSError, ValueError) as error:  # pragma: no cover - adapter fails first
            self._record(
                NovaError(
                    MediaErrorCode.DECODE_FAILED,
                    "this file could not be decoded",
                    details={
                        "asset_id": request.asset_id,
                        "frame": request.source_frame,
                        "reason": str(error),
                    },
                ),
                asset_id=request.asset_id,
            )
            return None
        self._stats = self._stats + PoolStats(seeks=before)
        failure = stream.last_error()
        if failure is not None:
            self._record(failure, asset_id=request.asset_id)
        if picture is None:
            self._stats = self._stats + PoolStats(gaps=1)
            return None
        self._remember(request.key, picture)
        return picture

    def _stream_for(self, asset_id: str, source: str) -> _Stream | None:
        """The open stream for one asset and one copy of it, opening it if needed."""
        handle_key = (asset_id, source)
        existing = self._open.get(handle_key)
        if existing is not None:
            self._open.move_to_end(handle_key)
            return existing
        if handle_key in self._missing:
            return None
        path = self._resolve(asset_id, source)
        if path is None:
            # Remembered rather than retried: a render asks for the same offline
            # asset once per frame, and resolving it again is a stat per frame.
            self._missing.add(handle_key)
            self._record(
                NovaError(
                    MediaErrorCode.UNREADABLE,
                    "this media file is not available",
                    details={"asset_id": asset_id, "source": source},
                    remedy="relink the media, or render from the proxy",
                ),
                asset_id=asset_id,
            )
            return None
        opened = self._decoder.open(path)
        if opened.is_err():
            self._missing.add(handle_key)
            self._record(opened.unwrap_err(), asset_id=asset_id)
            return None
        media = opened.unwrap()
        handle = media.video()
        if handle is None:
            media.close()
            self._missing.add(handle_key)
            self._record(
                NovaError(
                    MediaErrorCode.UNSUPPORTED,
                    "this media file has no video stream",
                    details={"asset_id": asset_id, "source": source},
                ),
                asset_id=asset_id,
            )
            return None
        self._evict_one_if_full()
        stream = _Stream(media, handle, path)
        self._open[handle_key] = stream
        self._stats = self._stats + PoolStats(opens=1)
        return stream

    def _evict_one_if_full(self) -> None:
        """Close the least recently used decoder when the pool is full."""
        while len(self._open) >= self._capacity:
            _, oldest = self._open.popitem(last=False)
            oldest.close()
            self._stats = self._stats + PoolStats(closes=1)

    def _remember(self, key: tuple[str, int, str], picture: FrameBuffer) -> None:
        """Cache a picture, and give up the oldest ones until it fits."""
        size = int(picture.pixels.nbytes)
        if size > self._cache_bytes:
            # One frame larger than the whole cache: caching it would empty the
            # cache and then be evicted by the next one.
            return
        self._cache[key] = picture
        self._cache_used += size
        while self._cache_used > self._cache_bytes and len(self._cache) > 1:
            _, dropped = self._cache.popitem(last=False)
            self._cache_used -= int(dropped.pixels.nbytes)
        if self._cache_used > self._cache_bytes:  # pragma: no cover - only when empty-able
            self._cache.clear()
            self._cache_used = 0

    def _record(self, error: NovaError, *, asset_id: str = "") -> None:
        """Latch a failure once per asset and code, keeping the first.

        A render that hits a damaged file asks for it on every frame, and the
        error list is for a summary at the end — a hundred thousand copies of
        the same sentence is not a summary. The **first** is the one kept,
        because for a damaged stream that is also the most useful: it names the
        frame where the file went wrong, which is the sentence a user can act
        on ("this clip is damaged at 00:03:12").

        Args:
            error: What happened.
            asset_id: What it happened to, when it happened to one thing.
        """
        key = (str(error.code), asset_id)
        if key not in self._seen:
            self._seen.add(key)
            self._errors.append(error)
