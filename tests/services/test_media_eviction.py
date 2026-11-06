"""`services/media/eviction.py` — how much derived data we keep.

What is being pinned is a rule about *size*, and a rule about *self*:

* **Evict the smallest set that fits, never everything old.** Throwing away a
  whole thumbnail cache to make room for one proxy is how an editor feels slow
  for an hour, so a pass stops the moment the budget is satisfied.
* **Never evict the artefact that is being admitted.** An entry is
  least-recently-used the instant it is created, so the job that wrote a proxy
  and then enforced the budget would otherwise be at the top of its own hit
  list. `keep` is the whole reason this module exists as a layer over the
  domain's `select_for_eviction`.

And one promise about honesty: **a shortfall is reported, not hidden.** A cache
that quietly exceeded its budget is the failure this module exists to prevent,
so when everything evictable is pinned the caller hears how many bytes are
still over rather than nothing at all.

The doubles are the same three the cache tests use — a dict for the index, a
set for the disk, a clock that only moves when a test moves it — because the
behaviour under test is a decision, and a decision is testable without SQLite.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.domain.persistence import (
    CacheBudget,
    CacheEntry,
    CacheKind,
    derived_path,
)
from nova_studio.services.media import (
    MediaCache,
    enforce_budget,
    plan_eviction,
)
from nova_studio.services.media.proxy import DEFAULT_PROXY_POLICY

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

#: A budget of ten megabytes, so a test can be over it with four entries and
#: not four thousand.
BUDGET = CacheBudget(max_bytes=10 * 1_048_576)

#: A budget smaller than two entries of the size the tests use, which is what
#: forces more than one to go.
TIGHT = CacheBudget(max_bytes=4 * 1_048_576)


class FakeClock:
    """A clock that only moves when a test moves it."""

    def now_ms(self) -> int:
        return 1_000


class FakeIndex:
    """The `CacheIndex` port, as a dictionary. Can refuse to remove, on cue."""

    def __init__(self, *, fail_remove: str | None = None) -> None:
        self.rows: dict[str, CacheEntry] = {}
        self.removed: list[str] = []
        self.fail_remove = fail_remove

    def get(self, key: str) -> CacheEntry | None:
        return self.rows.get(key)

    def put(self, entry: CacheEntry) -> Any:
        self.rows[entry.key] = entry
        from nova_studio.core.result import ok

        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Any:
        from nova_studio.core.result import ok

        return ok(None)

    def remove(self, key: str) -> Any:
        from nova_studio.core.result import ok

        self.removed.append(key)
        if key == self.fail_remove:
            from nova_studio.core.result import err

            return err(_unavailable())
        self.rows.pop(key, None)
        return ok(None)

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        found = [entry for entry in self.rows.values() if kind is None or entry.kind is kind]
        return tuple(sorted(found, key=lambda entry: entry.key))

    def total_bytes(self) -> int:
        return sum(entry.size_bytes for entry in self.rows.values())

    def close(self) -> None:
        return None


class FakeDisk:
    """The two answers the cache needs about a filesystem."""

    def __init__(self, *paths: str) -> None:
        self.there = set(paths)
        self.deleted: list[str] = []

    def exists(self, path: str) -> bool:
        return path in self.there

    def unlink(self, path: str) -> None:
        self.deleted.append(path)
        self.there.discard(path)


def _unavailable() -> Any:
    from nova_studio.core.errors import NovaError

    return NovaError("NS-PERSIST-5001", "the cache index is unavailable")


def entry(
    key: str, *, size_bytes: int = 4 * 1_048_576, used_ms: int = 1_000, pinned: bool = False
) -> CacheEntry:
    """One row. `used_ms` is what decides the order they go in."""
    return CacheEntry(
        key=key,
        kind=CacheKind.PROXY if key.startswith("proxy-") else CacheKind.THUMBNAIL,
        size_bytes=size_bytes,
        created_ms=used_ms,
        last_used_ms=used_ms,
        pinned=pinned,
    )


def cache_in(
    root: Path, rows: tuple[CacheEntry, ...], *, fail_remove: str | None = None
) -> tuple[MediaCache, FakeIndex, FakeDisk]:
    """A real `MediaCache` over a dict and a set, holding exactly `rows`."""
    index = FakeIndex(fail_remove=fail_remove)
    for row in rows:
        index.put(row)
    disk = FakeDisk(*(str(derived_path(root, row.kind, row.key)) for row in rows))
    cache = MediaCache(
        index=index,  # type: ignore[arg-type]
        root=root,
        clock=FakeClock(),  # type: ignore[arg-type]
        exists=disk.exists,
        unlink=disk.unlink,
        policy=DEFAULT_PROXY_POLICY,
    )
    return cache, index, disk


class TestPlanning:
    """`plan_eviction`: the choice, with no cache in the room."""

    def test_nothing_goes_when_the_cache_is_within_budget(self) -> None:
        rows = (entry("proxy-a1-h720.mkv"),)
        assert plan_eviction(rows, BUDGET) == ()

    def test_the_least_recently_used_goes_first(self) -> None:
        rows = (
            entry("proxy-a1-h720.mkv", used_ms=9_000),
            entry("proxy-a2-h720.mkv", used_ms=1_000),
            entry("proxy-a3-h720.mkv", used_ms=5_000),
        )
        assert [row.key for row in plan_eviction(rows, BUDGET)] == ["proxy-a2-h720.mkv"]
        # Asked for more room, the same order holds: two go, the newest stays.
        assert [row.key for row in plan_eviction(rows, TIGHT)] == [
            "proxy-a2-h720.mkv",
            "proxy-a3-h720.mkv",
        ]

    def test_only_what_the_budget_needs(self) -> None:
        """Two of three go, not everything: a pass stops when the budget is
        met, because a cache emptied to make room is a cache rebuilt."""
        rows = (
            entry("proxy-a1-h720.mkv", used_ms=9_000),
            entry("proxy-a2-h720.mkv", used_ms=2_000),
            entry("proxy-a3-h720.mkv", used_ms=1_000),
        )
        assert [row.key for row in plan_eviction(rows, TIGHT)] == [
            "proxy-a3-h720.mkv",
            "proxy-a2-h720.mkv",
        ]

    def test_the_biggest_is_not_chosen_for_being_biggest(self) -> None:
        """LRU, not LRU-with-a-size-preference: the newest entry is the largest
        one here, and it stays."""
        rows = (
            entry("proxy-a1-h720.mkv", size_bytes=8 * 1_048_576, used_ms=9_000),
            entry("thumb-a2-f0-w320.jpg", size_bytes=1_048_576, used_ms=8_000),
            entry("thumb-a3-f0-w320.jpg", size_bytes=1_048_576, used_ms=7_000),
            entry("thumb-a4-f0-w320.jpg", size_bytes=1_048_576, used_ms=6_000),
        )
        assert [row.key for row in plan_eviction(rows, BUDGET)] == ["thumb-a4-f0-w320.jpg"]

    def test_admitting_bytes_can_force_a_pass_when_under_budget(self) -> None:
        rows = (entry("proxy-a1-h720.mkv", used_ms=9_000),)
        assert plan_eviction(rows, BUDGET, needed_bytes=8 * 1_048_576) == rows

    def test_a_pinned_entry_is_never_chosen(self) -> None:
        rows = (entry("proxy-a1-h720.mkv", used_ms=1_000, pinned=True),)
        assert plan_eviction(rows, BUDGET, needed_bytes=1) == ()

    def test_what_is_kept_is_not_chosen_but_still_counted(self) -> None:
        """The artefact being admitted: safe from its own eviction pass, and
        still occupying the bytes it occupies."""
        fresh = entry("proxy-a1-h720.mkv", used_ms=1_000)
        older = entry("proxy-a2-h720.mkv", used_ms=2_000)
        assert [row.key for row in plan_eviction((fresh, older), TIGHT)] == [fresh.key]
        assert [
            row.key for row in plan_eviction((fresh, older), TIGHT, keep=frozenset({fresh.key}))
        ] == [older.key]


class TestEnforcing:
    """`enforce_budget`: the choice, carried out."""

    def test_what_goes_is_forgotten_and_counted(self, tmp_path: Path) -> None:
        rows = (
            entry("proxy-a1-h720.mkv", used_ms=1_000),
            entry("proxy-a2-h720.mkv", used_ms=2_000),
            entry("proxy-a3-h720.mkv", used_ms=3_000),
        )
        cache, index, disk = cache_in(tmp_path, rows)

        report = enforce_budget(cache, BUDGET)

        assert report.freed == ("proxy-a1-h720.mkv",)
        assert report.freed_bytes == 4 * 1_048_576
        assert len(disk.deleted) == 1
        assert set(index.rows) == {"proxy-a2-h720.mkv", "proxy-a3-h720.mkv"}
        assert not report.over_budget

    def test_the_artefact_just_made_survives_its_own_pass(self, tmp_path: Path) -> None:
        """The rule this module exists for: a job that wrote a file must not
        delete it one line later."""
        fresh = entry("proxy-a1-h720.mkv", used_ms=1_000)
        older = entry("proxy-a2-h720.mkv", used_ms=2_000)
        cache, index, _disk = cache_in(tmp_path, (fresh, older))

        report = enforce_budget(cache, TIGHT, keep=frozenset({fresh.key}))

        assert report.freed == (older.key,)
        assert fresh.key in index.rows

    def test_a_failure_to_forget_is_counted_not_raised(self, tmp_path: Path) -> None:
        """Housekeeping must not fail the job that triggered it — but a cache
        that stopped reclaiming is a bug nobody would find otherwise."""
        doomed = entry("proxy-a1-h720.mkv", used_ms=1_000)
        cache, index, _disk = cache_in(tmp_path, (doomed,), fail_remove=doomed.key)

        report = enforce_budget(cache, CacheBudget(max_bytes=1 * 1_048_576))

        assert report.freed == ()
        assert report.freed_bytes == 0
        assert report.failures == (doomed.key,)
        assert doomed.key in index.rows

    def test_a_shortfall_is_reported_when_everything_is_pinned(self, tmp_path: Path) -> None:
        rows = (
            entry("proxy-a1-h720.mkv", used_ms=1_000, pinned=True),
            entry("proxy-a2-h720.mkv", used_ms=2_000, pinned=True),
            entry("proxy-a3-h720.mkv", used_ms=3_000, pinned=True),
        )
        cache, _index, _disk = cache_in(tmp_path, rows)

        report = enforce_budget(cache, BUDGET)

        assert report.freed == ()
        assert report.over_budget
        assert report.shortfall == 2 * 1_048_576
        assert "still over budget" in report.summary

    def test_a_budget_smaller_than_one_artefact_is_still_reported(self, tmp_path: Path) -> None:
        fresh = entry("proxy-a1-h720.mkv", used_ms=1_000)
        older = entry("proxy-a2-h720.mkv", used_ms=2_000)
        cache, _index, _disk = cache_in(tmp_path, (fresh, older))

        report = enforce_budget(
            cache, CacheBudget(max_bytes=1 * 1_048_576), keep=frozenset({fresh.key})
        )

        assert report.freed == (older.key,)
        assert report.shortfall == 3 * 1_048_576

    def test_a_cache_within_budget_says_so(self, tmp_path: Path) -> None:
        cache, index, disk = cache_in(tmp_path, (entry("proxy-a1-h720.mkv"),))

        report = enforce_budget(cache, BUDGET)

        assert report == type(report)()
        assert report.summary == "cache within budget"
        assert disk.deleted == []
        assert len(index.rows) == 1

    def test_an_entry_whose_file_has_gone_is_not_evicted(self, tmp_path: Path) -> None:
        """There is nothing to reclaim, and the row is already a miss."""
        cache, index, disk = cache_in(tmp_path, ())
        index.put(entry("proxy-a1-h720.mkv"))
        disk.deleted.clear()

        report = enforce_budget(cache, BUDGET)

        assert report.freed == ()
        assert "proxy-a1-h720.mkv" in index.rows
