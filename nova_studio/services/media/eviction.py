"""L3 — the byte budget: what to throw away, and how much of it.

`cache.py` answers *which copy a decode should read*, and `generation.py`
answers *how a copy is made*. This module answers the question that keeps the
other two honest: **how much derived data we are willing to keep.**

    A cache nobody cleans is a disk that fills up.

Everything here is *derived* — a proxy can be transcoded again and a thumbnail
decoded again — so the only thing at stake when an entry goes is time, and the
only thing worth protecting is the thing being used. That is why the policy is
LRU and why a pinned entry is never chosen.

**The decision is not made here.** :func:`nova_studio.domain.persistence
.select_for_eviction` is the pure function that chooses, and it lives in the
domain because two layers need the same rule: the index that records entries
describes them, and the worker that admits bytes enforces the budget over them.
What this module adds is the half that needs a cache — reading what is held,
asking the policy, and dropping what it named.

Two rules that are the difference between a budget and a bug:

1. **Evict the smallest set that fits, never everything old.** Throwing away a
   whole thumbnail cache to make room for one proxy is how an editor feels slow
   for an hour.
2. **Never evict what the caller just made.** The job that wrote a proxy and
   then enforced the budget would otherwise be at the top of its own hit list —
   an entry is least-recently-used the instant it is created. :func:`keep`
   exists for that, and the artefact is safe until the *next* admission, or
   until somebody calls :func:`enforce_budget` without naming it.

**A shortfall is reported, not hidden.** When everything evictable is pinned,
or the budget is smaller than the artefact being admitted, the report says how
many bytes are still over. A cache that silently exceeded its budget is the
failure this module exists to prevent, and a caller that cannot hear about it
cannot do anything about it either.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from nova_studio.domain.persistence import CacheBudget, CacheEntry, select_for_eviction

if TYPE_CHECKING:
    from collections.abc import Iterable

    from nova_studio.services.media.cache import MediaCache

__all__ = [
    "DEFAULT_CACHE_BUDGET",
    "EvictionReport",
    "enforce_budget",
    "plan_eviction",
]


#: What a desktop install is willing to keep, unless the user says otherwise.
#: Eight gigabytes: roughly forty minutes of 1080p proxy, or a bin's worth of
#: thumbnails for a feature — big enough that a project survives a day of
#: editing without a rebuild, small enough that the cache is never the reason a
#: drive is full. There is no entry cap: a thumbnail costs thirty kilobytes and
#: a cap would bite long before the bytes did.
DEFAULT_CACHE_BUDGET: Final[CacheBudget] = CacheBudget(max_bytes=8 * 1024**3)


@dataclass(frozen=True, slots=True)
class EvictionReport:
    """What one eviction pass did, in one value.

    Attributes:
        freed: The keys that went, in the order they went — least recently
            used first, which is the order a log wants to read them in.
        freed_bytes: How much disk that was, by the entries' own accounting.
        needed_bytes: What the caller was about to admit, and the reason the
            pass happened at all.
        shortfall: Bytes still over the budget when the pass ended: non-zero
            only when everything evictable was pinned, or when the budget is
            smaller than one artefact.
        failures: Keys that were chosen and refused to be forgotten. They are
            still held, and their bytes are not counted in `freed_bytes` —
            a caller that asked for twelve and hears eleven knows one is on
            the disk instead of assuming it worked.
    """

    freed: tuple[str, ...] = ()
    freed_bytes: int = 0
    needed_bytes: int = 0
    shortfall: int = 0
    failures: tuple[str, ...] = ()

    @property
    def over_budget(self) -> bool:
        """Whether the cache is still above its budget after this pass."""
        return self.shortfall > 0

    @property
    def summary(self) -> str:
        """One line, for a log and for a panel that asks what happened."""
        if not self.freed and self.shortfall == 0:
            return "cache within budget"
        parts = [f"evicted {len(self.freed)} entr{'y' if len(self.freed) == 1 else 'ies'}"]
        parts.append(f"freed {self.freed_bytes / 1_048_576:.1f} MB")
        if self.shortfall:
            parts.append(f"{self.shortfall / 1_048_576:.1f} MB still over budget")
        if self.failures:
            parts.append(f"{len(self.failures)} could not be removed")
        return ", ".join(parts)


def plan_eviction(
    entries: Iterable[CacheEntry],
    budget: CacheBudget,
    *,
    needed_bytes: int = 0,
    keep: frozenset[str] = frozenset(),
) -> tuple[CacheEntry, ...]:
    """Which of ``entries`` should go so that ``needed_bytes`` fits.

    The pure half: a sequence in, a tuple of entries out, no cache and no disk.
    Delegates to :func:`~nova_studio.domain.persistence.select_for_eviction`,
    which sorts least-recently-used first, skips pinned entries and stops as
    soon as the budget is satisfied.

    Keys in `keep` are never chosen, but their bytes are still counted — a
    policy that ignored them would think there was more room than there is and
    under-evict by exactly the size of what was kept.

    Args:
        entries: What the cache holds.
        budget: The budget to stay within.
        needed_bytes: Bytes about to be admitted. Zero means "truncate to the
            budget", which is what a manual trim asks for.
        keep: Keys that must not be chosen — the artefact being admitted, and
            anything else the caller is still using.

    Returns:
        The entries to delete, oldest-first. Empty when nothing needs to go.
    """
    kept = tuple(entry for entry in entries if entry.key in keep)
    held = tuple(entry for entry in entries if entry.key not in keep)
    return select_for_eviction(held, needed_bytes + sum(e.size_bytes for e in kept), budget)


def enforce_budget(
    cache: MediaCache,
    budget: CacheBudget = DEFAULT_CACHE_BUDGET,
    *,
    needed_bytes: int = 0,
    keep: frozenset[str] = frozenset(),
) -> EvictionReport:
    """Bring the cache back within ``budget``, and report what it cost.

    Admission control: called by a job after it has recorded new bytes, with
    those bytes in `needed_bytes` and their key in `keep`, so that the cache
    can never grow past what the user allowed for more than one artefact.

    A failure to forget is *counted, not raised*. Eviction is housekeeping: a
    job that made a perfectly good proxy must not fail because an unrelated
    entry could not be deleted — but the caller is told, because a cache that
    quietly stopped reclaiming is a bug nobody would find otherwise.

    Args:
        cache: The cache to trim.
        budget: The budget to stay within.
        needed_bytes: Bytes about to be admitted, or zero to truncate.
        keep: Keys that must survive this pass.

    Returns:
        An :class:`EvictionReport`. Never raises for a disk or index failure.
    """
    # Only what we really hold: an entry whose file has gone is not ours to
    # count, and evicting it would not free anything.
    held = cache.entries()
    doomed = plan_eviction(held, budget, needed_bytes=needed_bytes, keep=keep)

    freed: list[str] = []
    failures: list[str] = []
    freed_bytes = 0
    for entry in doomed:
        if cache.forget(entry.key).is_ok():
            freed.append(entry.key)
            freed_bytes += entry.size_bytes
        else:
            failures.append(entry.key)

    used = sum(entry.size_bytes for entry in held)
    shortfall = max(0, used - freed_bytes + needed_bytes - budget.max_bytes)
    return EvictionReport(
        freed=tuple(freed),
        freed_bytes=freed_bytes,
        needed_bytes=needed_bytes,
        shortfall=shortfall,
        failures=tuple(failures),
    )
