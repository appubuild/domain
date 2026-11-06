"""`services/media/cache.py` — which copy of a file a decode should read.

What is being pinned is the promise `media-and-rendering.md` §7.2 makes and
every other layer now leans on: **proxies are transparent**. Concretely, three
decisions that would each be a different bug if they went the other way:

* **A missing copy degrades the picture, it does not remove it.** Asked for a
  proxy that is not there, the cache answers with the original. A preview that
  turned into a gap because a proxy was still being generated would be the
  opposite of transparent.
* **Holding a copy needs an entry *and* a file.** Either alone is a lie the user
  pays for: an entry with no file promises pictures that cannot be produced, and
  a file with no entry is disk nobody will ever reclaim.
* **The read path does not write.** "Which copy should I decode" is asked sixty
  times a second while scrubbing; an `UPDATE` per answer would make the cache a
  net cost to the disk it exists to spare.

The doubles are deliberately tiny — a dict for the index, a set for the disk, a
clock that only moves when a test moves it. No SQLite, no filesystem, no
decoder: the behaviour under test is a decision, and a decision is testable
without a disk.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.result import Result, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import AssetKind, MediaAsset, MediaInfo, VideoStreamInfo
from nova_studio.domain.persistence import CacheEntry, CacheKind, derived_path
from nova_studio.domain.project import Project
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.services.media import ProxyPolicy, proxy_key
from nova_studio.services.media.cache import MediaCache, _fallback_chain
from nova_studio.services.media.keys import thumbnail_key
from nova_studio.services.media.proxy import DecodeSource

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit

ASSET_ID = "a1"
#: A 1080p h264 clip: bigger than the preview needs, and cheap to seek, so
#: `ProxyPolicy` earns it a 720p proxy and nothing else.
PROBE = MediaInfo(
    kind=AssetKind.VIDEO,
    duration_seconds=10.0,
    video=(
        VideoStreamInfo(
            codec_name="h264", width=1920, height=1080, timebase=Timebase(num=30, den=1)
        ),
    ),
)
POLICY = ProxyPolicy()


# -- doubles -----------------------------------------------------------------


class FakeClock:
    """A clock that only moves when a test moves it."""

    def __init__(self, now_ms: int = 1_000) -> None:
        self.now = now_ms

    def now_ms(self) -> int:
        return self.now

    def advance(self, by_ms: int) -> None:
        self.now += by_ms


class FakeIndex:
    """The `CacheIndex` port, as a dictionary. Remembers what it was told."""

    def __init__(self) -> None:
        self.entries: dict[str, CacheEntry] = {}
        self.touched: list[str] = []
        self.removed: list[str] = []
        self.closed = False

    def get(self, key: str) -> CacheEntry | None:
        return self.entries.get(key)

    def put(self, entry: CacheEntry) -> Result[None]:
        self.entries[entry.key] = entry
        return ok(None)

    def touch(self, key: str, *, at_ms: int) -> Result[None]:
        self.touched.append(key)
        existing = self.entries.get(key)
        if existing is not None:
            self.entries[key] = existing.touch(at_ms)
        return ok(None)

    def remove(self, key: str) -> Result[None]:
        self.removed.append(key)
        self.entries.pop(key, None)
        return ok(None)

    def entries(self, kind: CacheKind | None = None) -> tuple[CacheEntry, ...]:
        found = [entry for entry in self.entries.values() if kind is None or entry.kind is kind]
        return tuple(sorted(found, key=lambda entry: entry.key))

    def total_bytes(self) -> int:
        return sum(entry.size_bytes for entry in self.entries.values())

    def close(self) -> None:
        self.closed = True


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


def cache_in(
    root: Path,
    *,
    files: tuple[str, ...] = (),
    rows: tuple[CacheEntry, ...] = (),
    now_ms: int = 1_000,
) -> tuple[MediaCache, FakeIndex, FakeDisk, FakeClock]:
    """A cache, its index, its disk and its clock — every one of them fake."""
    index = FakeIndex()
    for row in rows:
        index.put(row)
    disk = FakeDisk(*files)
    clock = FakeClock(now_ms)
    cache = MediaCache(
        index=index,  # type: ignore[arg-type]
        root=root,
        clock=clock,  # type: ignore[arg-type]
        exists=disk.exists,
        unlink=disk.unlink,
        policy=POLICY,
    )
    return cache, index, disk, clock


def project_holding(*assets: MediaAsset, clips: tuple[Clip, ...] = ()) -> Project:
    """A project whose one video track holds `clips`, usually of `assets`."""
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        assets=assets,
        timeline=Timeline.of(
            Track(track_id="v1", kind=TrackKind.VIDEO, clips=clips),
            timebase=Timebase(num=30, den=1),
        ),
    )


def probed(*, asset_id: str = ASSET_ID) -> Project:
    """One clip of one probed asset — the ordinary case."""
    asset = MediaAsset(EntityId(asset_id), f"/media/{asset_id}.mp4", AssetKind.VIDEO, probe=PROBE)
    return project_holding(asset, clips=(Clip.of("c1", asset_id, source_frames=30),))


def unprobed() -> Project:
    """One clip of an asset that was never probed: no size to aim a proxy at."""
    asset = MediaAsset(EntityId(ASSET_ID), "/media/a1.mp4", AssetKind.VIDEO)
    return project_holding(asset, clips=(Clip.of("c1", ASSET_ID, source_frames=30),))


def proxy_entry(asset_id: str = ASSET_ID, *, at_ms: int = 1_000) -> tuple[str, CacheEntry]:
    """The key/row pair a finished 720p proxy leaves behind."""
    key = proxy_key(asset_id, height=POLICY.plan(PROBE).target_height)
    return key, CacheEntry(
        key=key,
        kind=CacheKind.PROXY,
        size_bytes=4_096,
        created_ms=at_ms,
        last_used_ms=at_ms,
    )


def proxy_path(root: Path, key: str) -> str:
    return str(derived_path(root, CacheKind.PROXY, key))


# -- what a copy is called ---------------------------------------------------


class TestTheKeyVocabulary:
    """Names are derived, never assigned — that is what makes the cache
    disposable and still worth having."""

    def test_the_same_question_gets_the_same_key(self) -> None:
        """A strip laid out today and the same strip after a reopen ask for the
        same names, which is why a wiped cache can simply be rebuilt."""
        assert proxy_key(ASSET_ID, height=720) == proxy_key(ASSET_ID, height=720)
        assert thumbnail_key(ASSET_ID, frame=1, width=320) == thumbnail_key(
            ASSET_ID, frame=1, width=320
        )

    def test_different_bytes_get_different_names(self) -> None:
        assert proxy_key(ASSET_ID, height=720) != proxy_key(ASSET_ID, height=480)
        assert thumbnail_key(ASSET_ID, frame=1, width=320) != thumbnail_key(
            ASSET_ID, frame=2, width=320
        )

    def test_a_key_says_where_it_lives(self, tmp_path: Path) -> None:
        """So an inspector can turn a row into a path without a second table."""
        key = proxy_key(ASSET_ID, height=720)
        assert key.startswith("proxy-")
        assert key.endswith(".mkv")
        assert derived_path(tmp_path, CacheKind.PROXY, key).parent == tmp_path / "proxy"

    @pytest.mark.parametrize("height", [0, 1, 3, 721])
    def test_a_height_the_encoder_would_reject_is_refused_here(self, height: int) -> None:
        """Refused at naming time rather than by FFmpeg, because by then a job
        has been scheduled and a worker is already running."""
        with pytest.raises(NovaInvariantError):
            proxy_key(ASSET_ID, height=height)

    @pytest.mark.parametrize("bad", ["", "..", "/etc/passwd", "a/b"])
    def test_an_asset_id_that_would_escape_the_directory_is_refused(self, bad: str) -> None:
        """A cache is derived data, and derived data is deleted by the directory.
        A name that could point outside it would make a delete unbounded."""
        with pytest.raises(NovaInvariantError):
            proxy_key(bad, height=720)

    def test_a_negative_frame_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            thumbnail_key(ASSET_ID, frame=-1, width=320)


# -- which file is this copy -------------------------------------------------


class TestResolving:
    """`resolve`: one asset, one copy, with a fallback towards the original."""

    def test_the_original_is_the_users_own_file(self, tmp_path: Path) -> None:
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.resolve(probed(), ASSET_ID, "original") == "/media/a1.mp4"

    def test_a_copy_we_do_not_hold_is_the_original(self, tmp_path: Path) -> None:
        """The whole trick. A cache miss degrades the picture; it does not
        remove it. The alternative — a gap in the composite while a proxy is
        still transcoding — is the opposite of transparent."""
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.resolve(probed(), ASSET_ID, "proxy") == "/media/a1.mp4"

    def test_a_copy_we_hold_is_the_generated_file(self, tmp_path: Path) -> None:
        key, entry = proxy_entry()
        path = proxy_path(tmp_path, key)
        cache, _index, _disk, _clock = cache_in(tmp_path, files=(path,), rows=(entry,))
        assert cache.resolve(probed(), ASSET_ID, "proxy") == path

    def test_an_entry_with_no_file_is_not_held(self, tmp_path: Path) -> None:
        """The user deleted the cache directory by hand. An entry that still
        promised those bytes would send every decode to a file that is gone."""
        _key, entry = proxy_entry()
        cache, _index, _disk, _clock = cache_in(tmp_path, rows=(entry,))
        assert cache.resolve(probed(), ASSET_ID, "proxy") == "/media/a1.mp4"

    def test_a_file_with_no_entry_is_not_held_either(self, tmp_path: Path) -> None:
        """Bytes no row names are bytes eviction will never reclaim, and
        offering them would make the index a liar about what it holds."""
        key, _entry = proxy_entry()
        cache, _index, _disk, _clock = cache_in(tmp_path, files=(proxy_path(tmp_path, key),))
        assert cache.resolve(probed(), ASSET_ID, "proxy") == "/media/a1.mp4"

    def test_an_unknown_asset_is_none(self, tmp_path: Path) -> None:
        """Not the original, and not a guess: nothing downstream can draw a
        frame from an asset the project does not have."""
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.resolve(probed(), "ghost", "original") is None

    def test_a_word_we_do_not_know_is_asked_for_the_original(self, tmp_path: Path) -> None:
        """A caller inventing a source name is not making a request we can fail
        usefully, and the render feature's own default *is* the original."""
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.resolve(probed(), ASSET_ID, "telepathy") == "/media/a1.mp4"

    def test_the_fallback_only_ever_runs_towards_the_original(self) -> None:
        """Never the other way: a smaller copy cannot be substituted for the one
        the user is judging at full size."""
        assert _fallback_chain("thumbnail") == (
            DecodeSource.THUMBNAIL,
            DecodeSource.PROXY,
            DecodeSource.ORIGINAL,
        )
        assert _fallback_chain("proxy") == (DecodeSource.PROXY, DecodeSource.ORIGINAL)
        assert _fallback_chain("original") == (DecodeSource.ORIGINAL,)
        assert _fallback_chain("nonsense") == (DecodeSource.ORIGINAL,)

    def test_a_resolver_is_a_live_question_not_a_captured_answer(self, tmp_path: Path) -> None:
        """A project is a frozen value the workspace replaces on every edit, so
        the resolver closes over the question, not over one answer."""
        key, entry = proxy_entry()
        path = proxy_path(tmp_path, key)
        cache, _index, _disk, _clock = cache_in(tmp_path, files=(path,), rows=(entry,))
        resolve = cache.resolver_for(probed())
        assert resolve(ASSET_ID, "proxy") == path
        assert resolve(ASSET_ID, "thumbnail") == path


# -- bookkeeping -------------------------------------------------------------


class TestBookkeeping:
    """Recording what we hold, and dropping it again."""

    def test_recording_writes_a_row_of_the_right_kind(self, tmp_path: Path) -> None:
        cache, index, _disk, _clock = cache_in(tmp_path)
        key, _ = proxy_entry()
        cache.record(key, size_bytes=2_048)
        assert index.entries[key].kind is CacheKind.PROXY
        assert index.entries[key].size_bytes == 2_048
        assert index.total_bytes() == 2_048

    def test_a_thumbnail_records_as_a_thumbnail(self, tmp_path: Path) -> None:
        cache, index, _disk, _clock = cache_in(tmp_path)
        key = thumbnail_key(ASSET_ID, frame=0, width=320)
        cache.record(key, size_bytes=900)
        assert index.entries[key].kind is CacheKind.THUMBNAIL

    def test_a_use_is_not_written_sixty_times_a_second(self, tmp_path: Path) -> None:
        """LRU is a ranking, not a log. A write per read would make the cache a
        net cost to the disk it exists to spare."""
        key, entry = proxy_entry()
        path = proxy_path(tmp_path, key)
        cache, index, _disk, clock = cache_in(tmp_path, files=(path,), rows=(entry,))
        for _ in range(50):
            cache.acknowledge(key)
        assert index.touched == [key]

        clock.advance(5_000)
        cache.acknowledge(key)
        assert index.touched == [key, key]

    def test_forgetting_deletes_the_file_before_the_row(self, tmp_path: Path) -> None:
        """In that order, so an interrupted removal leaves an entry pointing at
        nothing — which `has` already reads as a miss — rather than unreachable
        bytes no entry names."""
        key, entry = proxy_entry()
        path = proxy_path(tmp_path, key)
        cache, index, disk, _clock = cache_in(tmp_path, files=(path,), rows=(entry,))
        assert cache.has(key)
        cache.forget(key)
        assert disk.deleted == [path]
        assert index.removed == [key]
        assert not cache.has(key)

    def test_forgetting_never_raises_for_a_file_that_is_already_gone(self, tmp_path: Path) -> None:
        """The row is the part that must go; a file another process deleted is
        not a failure the caller can act on."""
        key, entry = proxy_entry()
        cache, index, disk, _clock = cache_in(tmp_path, rows=(entry,))
        cache.forget(key)
        assert disk.deleted == [proxy_path(tmp_path, key)]
        assert index.removed == [key]


# -- which copy at which scale -----------------------------------------------


class TestChoosingACopy:
    """`sources_for`: one mapping for a whole frame, from one number."""

    def test_a_full_scale_preview_decodes_the_original(self, tmp_path: Path) -> None:
        """At 1:1 the user is judging colour, grain and sharpness — a proxy
        would be a lie told at exactly the moment it mattered."""
        key, entry = proxy_entry()
        cache, _index, _disk, _clock = cache_in(
            tmp_path, files=(proxy_path(tmp_path, key),), rows=(entry,)
        )
        assert cache.sources_for(probed(), scale=1.0) == {}

    @pytest.mark.parametrize("scale", [0.5, 0.25, 0.1])
    def test_a_reduced_preview_wants_the_proxy_we_hold(self, tmp_path: Path, scale: float) -> None:
        key, entry = proxy_entry()
        cache, _index, _disk, _clock = cache_in(
            tmp_path, files=(proxy_path(tmp_path, key),), rows=(entry,)
        )
        assert cache.sources_for(probed(), scale=scale) == {ASSET_ID: "proxy"}

    def test_a_copy_we_do_not_hold_is_never_chosen(self, tmp_path: Path) -> None:
        """Choosing a proxy that is not there would turn every layer into a gap,
        and a composite made of gaps is not a preview."""
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.sources_for(probed(), scale=0.1) == {}

    def test_an_asset_with_no_probe_is_left_alone(self, tmp_path: Path) -> None:
        """No probe means no size to aim at, so no key — and asking anyway would
        create a cache entry nobody could ever find again."""
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.sources_for(unprobed(), scale=0.1) == {}

    def test_a_clip_whose_asset_is_not_in_the_project_is_skipped(self, tmp_path: Path) -> None:
        project = project_holding(
            MediaAsset(EntityId("other"), "/media/other.mp4", AssetKind.VIDEO, probe=PROBE),
            clips=(Clip.of("c1", "ghost", source_frames=30),),
        )
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.sources_for(project, scale=0.1) == {}

    def test_an_empty_timeline_asks_for_nothing(self, tmp_path: Path) -> None:
        cache, _index, _disk, _clock = cache_in(tmp_path)
        assert cache.sources_for(project_holding(), scale=0.1) == {}

    def test_the_answer_is_a_string_the_render_feature_understands(self, tmp_path: Path) -> None:
        """Features do not import each other's types, so the mapping talks in
        the plain strings `DecodeRequest` already carries."""
        key, entry = proxy_entry()
        cache, _index, _disk, _clock = cache_in(
            tmp_path, files=(proxy_path(tmp_path, key),), rows=(entry,)
        )
        assert cache.sources_for(probed(), scale=0.25)[ASSET_ID] == str(DecodeSource.PROXY)

    def test_a_scale_of_zero_is_a_bug_not_a_question(self, tmp_path: Path) -> None:
        cache, _index, _disk, _clock = cache_in(tmp_path)
        with pytest.raises(NovaInvariantError):
            cache.sources_for(probed(), scale=0.0)
