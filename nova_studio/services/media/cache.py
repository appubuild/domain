"""L3 — the media cache: which copy of a file a decode should read.

`media-and-rendering.md` §7.2 promises that **proxies are transparent**: a clip
references an asset, the asset resolves to ``original | proxy | thumbnail``, and
nothing downstream knows which one it decoded. This is the object that keeps the
promise, and it is the seam the render feature already asks for —
``SourceResolver`` is ``(asset_id, source) -> path | None``, and until now the
only implementation was "the original, and nothing else".

**What it is not.** It is not a store: the bytes live in files and the
bookkeeping lives in a :class:`~nova_studio.ports.persistence.CacheIndex`, both
of which are handed in. It is not the generator either — making a proxy is a
``NORMAL`` job on the scheduler (ADR-0010), and a service that transcoded on the
request path would be the reason an editor froze.

Two questions it answers, and one it deliberately does not:

* **Which file *is* this decode's copy?** :meth:`resolve` — for one asset, at
  one moment, with a fallback (below).
* **At this preview scale, which copy *should* each asset use?**
  :meth:`sources_for` — the whole mapping at once, because a frame is composited
  from several clips and asking per layer would mean asking the policy twenty
  times a frame.
* **Should we make a proxy?** Not asked here. That is
  :meth:`~nova_studio.services.media.proxy.ProxyPolicy.plan`, and its answer
  becomes a job.

**The fallback runs towards the original, and that is the whole trick.** Asked
for a thumbnail that is not there, this answers with the proxy; asked for a
proxy that has gone, it answers with the original. The alternative — a cache
miss as a *gap* in the composite — would make a preview disappear because a
thumbnail had not been generated yet, which is the opposite of transparent. A
copy that is missing degrades the picture; only an original that is missing
removes it, and that is a relink, not a cache miss.

**Two seams are injected rather than assumed**: ``exists`` and ``unlink``. A
service that called ``Path.exists`` could not be tested without a filesystem,
and the questions they answer — *is it still there*, *delete it* — are the only
two facts about the disk this module needs. The composition root supplies the
real ones; a test supplies a set.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final, TypeAlias

from nova_studio.domain.persistence import CacheEntry, CacheKind, derived_path
from nova_studio.services.media.keys import kind_of, proxy_key
from nova_studio.services.media.proxy import DEFAULT_PROXY_POLICY, DecodeSource, ProxyPolicy

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
    from pathlib import Path

    from nova_studio.core.result import Result
    from nova_studio.domain.media import MediaAsset
    from nova_studio.domain.project import Project
    from nova_studio.ports.clock import Clock
    from nova_studio.ports.persistence import CacheIndex

#: "Is this file still there?" The one question about the disk this module
#: asks. Injected because a service that stat()ed the filesystem could not be
#: tested without one, and because the answer is a boolean, not a policy.
ExistsFn: TypeAlias = "Callable[[str], bool]"

#: "Delete this file, and do not mind if it is already gone." Injected for the
#: same reason, and because the cache index only deletes *rows* — the bytes
#: belong to whoever wrote them.
UnlinkFn: TypeAlias = "Callable[[str], None]"

__all__ = ["CacheDrop", "ExistsFn", "MediaCache", "SourceResolver", "UnlinkFn"]

#: What the render feature asks for and this object supplies. Restated here so
#: a reader of this module sees the contract it is satisfying.
SourceResolver: TypeAlias = "Callable[[str, str], str | None]"

#: How often one key's use may be written down, in milliseconds.
#:
#: LRU is a *ranking*, not a log: a key read sixty times a second does not need
#: sixty writes to be ranked first. Without this, every frame of a scrub would
#: `UPDATE` the row of every asset on the timeline, which is a write per read —
#: the one thing a cache must never do to the disk it exists to spare.
TOUCH_INTERVAL_MS: Final[int] = 5_000


@dataclass(frozen=True, slots=True)
class CacheDrop:
    """What forgetting cost.

    Two numbers, because the two questions a panel asks are "how many" and "how
    much disk", and a caller given one would immediately recompute the other.
    """

    #: Entries that were actually removed.
    entries: int = 0
    #: Bytes those entries had named.
    size_bytes: int = 0


@dataclass(frozen=True, slots=True)
class MediaCache:
    """Which copy of a file a decode should read, and what we still hold.

    Frozen, because it is built once per session and read on every frame: a
    cache whose policy could change mid-preview would make the same frame
    decode from two different files.

    Attributes:
        index: The bookkeeping — what we hold, what it cost, when it was used.
        root: Where the derived bytes live.
        clock: For `created_ms` and `last_used_ms`.
        exists: Whether a path is still on the disk.
        unlink: Delete a path, ignoring one that is already gone.
        policy: Which copy a decode should want, and how big a proxy is.
    """

    index: CacheIndex
    root: Path
    clock: Clock
    exists: ExistsFn
    unlink: UnlinkFn
    policy: ProxyPolicy = DEFAULT_PROXY_POLICY
    #: When each key's use was last written down. In memory and deliberately
    #: approximate: two threads racing to note the same key write the same
    #: value, and the worst case is an entry a few seconds behind the truth.
    _touched: dict[str, int] = field(default_factory=dict)

    # -- where things live -------------------------------------------------

    def path_for(self, key: str) -> Path:
        """Where the bytes for ``key`` live, whether or not they are there."""
        return derived_path(self.root, kind_of(key), key)

    def has(self, key: str) -> bool:
        """Whether we hold ``key``: an entry *and* a file.

        Both, because either alone is a lie the user pays for. An entry with no
        file is a cache that promises pictures it cannot produce; a file with no
        entry is bytes nobody will ever find, and eviction will never reclaim
        them.
        """
        return self.index.get(key) is not None and self.exists(str(self.path_for(key)))

    # -- bookkeeping -------------------------------------------------------

    def record(self, key: str, *, size_bytes: int, at_ms: int | None = None) -> Result[None]:
        """Note that ``key`` exists and costs ``size_bytes``.

        Called by whatever generated the artefact, once the file is complete —
        never before, because a row for bytes that are still being written is a
        promise the pool will try to collect on.
        """
        now = self.clock.now_ms() if at_ms is None else at_ms
        return self.index.put(
            CacheEntry(
                key=key,
                kind=kind_of(key),
                size_bytes=size_bytes,
                created_ms=now,
                last_used_ms=now,
            )
        )

    def acknowledge(self, key: str) -> None:
        """Note that ``key`` was just used, so eviction ranks it last.

        Throttled to :data:`TOUCH_INTERVAL_MS` per key: this is called from the
        read path, and a write per read would make the cache a net cost to the
        disk it exists to spare.

        Nothing to return: a read that could not record its own use is not a
        reason to fail the frame it was feeding, and a preview that came back
        empty because bookkeeping failed would be the least forgivable bug in
        the editor.
        """
        now = self.clock.now_ms()
        if now - self._touched.get(key, now - TOUCH_INTERVAL_MS - 1) < TOUCH_INTERVAL_MS:
            return
        self._touched[key] = now
        self.index.touch(key, at_ms=now)

    def forget(self, key: str) -> Result[None]:
        """Drop ``key``: the file first, then the row.

        In that order, so an interrupted removal leaves an entry pointing at
        nothing — which :meth:`has` already reads as a miss — rather than bytes
        no entry names and no eviction will ever reclaim.
        """
        self.unlink(str(self.path_for(key)))
        return self.index.remove(key)

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        """What we hold, oldest use first — the order eviction will take them.

        Read-mostly: an inspector, a panel asking how much disk the proxies
        cost, and the byte budget. Nothing here opens a file, and an entry whose
        file has gone missing is not listed — a row without bytes is not
        something we hold.
        """
        held = [
            entry
            for entry in self.index.entries(kind)
            if self.exists(str(self.path_for(entry.key)))
        ]
        return tuple(sorted(held, key=lambda entry: (entry.last_used_ms, entry.key)))

    def total_bytes(self) -> int:
        """How much disk the entries name, whether or not the files are there.

        The index's own total, not a walk of the directory: a file no row names
        is not ours to count, and the difference between the two numbers is
        exactly what an inspector wants to see.
        """
        return self.index.total_bytes()

    def drop(self, kind: CacheKind | None = None) -> CacheDrop:
        """Forget everything of one kind, or everything.

        ``kind=None`` is "the user wants their disk back"; a single kind is
        "the thumbnails are stale" and costs nothing else. Either way the bytes
        go before the row, per entry, for the reason written in :meth:`forget`.

        An entry that refused to be removed stays held and is absent from the
        count, so a caller that asked to drop twelve and hears eleven knows one
        is still on the disk instead of assuming it worked.
        """
        dropped = 0
        freed = 0
        for entry in self.entries(kind):
            if self.forget(entry.key).is_ok():
                dropped += 1
                freed += entry.size_bytes
        return CacheDrop(entries=dropped, size_bytes=freed)

    # -- what a decode should read -----------------------------------------

    def resolver_for(self, project: Project) -> SourceResolver:
        """``(asset_id, which copy) -> path`` for one project, read live.

        Live, and not captured at construction: a project is a frozen value the
        workspace replaces on every edit, and a resolver holding the one from
        ten minutes ago would not know about the file the user just imported.
        """

        def resolve(asset_id: str, source: str) -> str | None:
            return self.resolve(project, asset_id, source)

        return resolve

    def resolve(self, project: Project, asset_id: str, source: str) -> str | None:
        """The path to read for one asset and one copy of it.

        Falls **back towards the original**: a missing thumbnail answers with a
        proxy, a missing proxy answers with the original. An original is the
        user's file, and it is reported whether or not it is reachable — the
        pool's ``open()`` is the honest place to discover a drive that is not
        plugged in, and a relink is a different problem from a cache miss.
        """
        asset = project.asset(asset_id)
        if asset is None:
            return None
        for candidate in _fallback_chain(source):
            if candidate is DecodeSource.ORIGINAL:
                return asset.path
            key = self._key_for(asset, candidate)
            if key is not None and self.has(key):
                self.acknowledge(key)
                return str(self.path_for(key))
        return None

    def sources_for(self, project: Project, *, scale: float) -> Mapping[str, str]:
        """Which copy every asset on the timeline should decode, at ``scale``.

        One mapping for the whole frame rather than a per-layer question,
        because a frame is composited from several clips and the decision is a
        pure function of one number.

        Args:
            project: The project being previewed.
            scale: Preview height divided by source height — ``1.0`` is a
                full-resolution preview, ``0.25`` a quarter-scale one.

        Returns:
            ``asset_id -> source name`` for every asset a clip references.
            Assets that should use the original are simply absent: the frame
            planner's default *is* the original, and spelling it out would be a
            dictionary entry per asset that says nothing.
        """
        chosen: dict[str, str] = {}
        for track in project.timeline.tracks:
            for clip in track.clips:
                asset = project.asset(clip.asset_id)
                if asset is None:
                    continue
                available = self._available(asset)
                wanted = self.policy.decide(scale=scale, available=available)
                if wanted is not DecodeSource.ORIGINAL:
                    chosen[clip.asset_id] = str(wanted)
        return chosen

    # -- internals ---------------------------------------------------------

    def _available(self, asset: MediaAsset) -> frozenset[DecodeSource]:
        """Which generated copies of this asset we actually hold."""
        found: set[DecodeSource] = set()
        for source in (DecodeSource.PROXY, DecodeSource.THUMBNAIL):
            key = self._key_for(asset, source)
            if key is not None and self.has(key):
                found.add(source)
        return frozenset(found)

    def _key_for(self, asset: MediaAsset, source: DecodeSource) -> str | None:
        """The cache key for one generated copy, or ``None`` when there is none.

        ``None`` covers three cases that are all the same answer: this copy of a
        proxy needs a size and the asset was never probed; the asset has no
        video stream; or the policy says a proxy is not worth building.
        """
        if source is not DecodeSource.PROXY or asset.probe is None:
            return None
        plan = self.policy.plan(asset.probe)
        if not plan.needed:
            return None
        return proxy_key(str(asset.asset_id), height=plan.target_height)


def _fallback_chain(source: str) -> tuple[DecodeSource, ...]:
    """Where to look, in order, when ``source`` is not there.

    Always ends at the original: a decode that cannot have the cheap copy can
    always have the true one, and a preview with no picture is not an
    acceptable way to say "the thumbnail is still being generated". A string
    that is not one of ours is treated as a request for the original, because
    that is what the render feature's own default means.
    """
    try:
        asked = DecodeSource(source)
    except ValueError:
        return (DecodeSource.ORIGINAL,)
    if asked is DecodeSource.THUMBNAIL:
        return (DecodeSource.THUMBNAIL, DecodeSource.PROXY, DecodeSource.ORIGINAL)
    if asked is DecodeSource.PROXY:
        return (DecodeSource.PROXY, DecodeSource.ORIGINAL)
    return (DecodeSource.ORIGINAL,)
