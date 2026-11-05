"""The frame source pool (`services/render/pool.py`).

A pool is a performance component, and a performance component that is not
measured is a superstition. Every test here can be read as an answer to one
question: **how many seeks did that cost?** Because that is the only thing the
pool is for — a decoder asked for frame *n* on its own may have to decode the
whole GOP before it, and the difference between an export that takes minutes
and one that takes hours is how often the pool makes it do that.

`tests/media/fake_decoder.py` makes the question answerable: it counts its
seeks, generates a frame whose colour *is* its frame number, and fails the way
a real decoder fails (`Err` on open, nothing after the damage, `DECODE_FAILED`
latched in `last_error`) rather than by raising.

What is being pinned:

* **Sequential is free, jumping is not.** A run of thirty frames costs one
  seek; a jump costs another; asking for a frame twice costs none.
* **Everything is bounded.** Decoders by count, cached pictures by *bytes* —
  not by entries, because a 4K frame is thirty times a 720p one.
* **Failure is a gap.** A missing file, a file that will not open, a file with
  no picture in it and a damaged stream all produce fewer pictures and a
  latched error. None of them raises, because a render that meets one bad file
  must not lose the other two hours.
* **A missing asset is remembered.** A render asks for the same offline file
  once per frame; resolving it again would be a stat per frame.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.core.errors import NovaError
from nova_studio.ports.media import MediaErrorCode
from nova_studio.services.render import DecodeRequest
from nova_studio.services.render.pool import FrameSourcePool
from tests.media.fake_decoder import FakeClip, FakeDecoder

pytestmark = pytest.mark.unit


def _resolve(*assets: str) -> Any:
    """A resolver that maps ``(asset_id, source)`` to ``"<asset>.mp4"``."""
    known = set(assets)

    def resolve(asset_id: str, source: str) -> str | None:
        del source  # a test resolver serves one copy of each asset
        return f"{asset_id}.mp4" if asset_id in known else None

    return resolve


def _counting_resolve(*assets: str) -> tuple[Any, list[str]]:
    """The same, recording every asset it was asked about."""
    asked: list[str] = []

    def resolve(asset_id: str, source: str) -> str | None:
        asked.append(asset_id)
        return _resolve(*assets)(asset_id, source)

    return resolve, asked


def _request(asset_id: str = "a1", frame: int = 0, source: str = "original") -> DecodeRequest:
    return DecodeRequest(clip_id="c1", asset_id=asset_id, source_frame=frame, source=source)


def _pool(
    decoder: FakeDecoder,
    *assets: str,
    capacity: int = 4,
    cache_bytes: int = 8 * 6 * 3 * 8,
) -> FrameSourcePool:
    return FrameSourcePool(decoder, _resolve(*assets), capacity=capacity, cache_bytes=cache_bytes)


def _grey(picture: Any) -> int:
    """The frame number a picture *is* — see `FakeVideoSource._picture`."""
    return int(picture.pixels[0, 0, 0])


class TestServing:
    def test_a_request_is_served(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pictures = pool.pictures([_request(frame=7)])
        assert _grey(pictures[_request(frame=7).key]) == 7

    def test_several_requests_are_served_from_one_open_file(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pictures = pool.pictures([_request(frame=n) for n in (0, 1, 2)])
        assert decoder.opens == 1
        assert sorted(_grey(picture) for picture in pictures.values()) == [0, 1, 2]

    def test_a_request_past_the_end_of_the_stream_is_a_gap(self) -> None:
        """Running off the end is how a render ends, not a failure."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=5)})
        with _pool(decoder, "a1") as pool:
            assert pool.pictures([_request(frame=99)]) == {}
            assert pool.stats.gaps == 1

    def test_two_copies_of_one_asset_are_two_streams(self) -> None:
        """An original and its proxy are different files with the same frames."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(), "a1-proxy.mp4": FakeClip()})

        def resolve(asset_id: str, source: str) -> str | None:
            return "a1.mp4" if source == "original" else "a1-proxy.mp4"

        with FrameSourcePool(decoder, resolve) as pool:
            pictures = pool.pictures([_request(source="original"), _request(source="proxy")])
        assert len(pictures) == 2
        assert decoder.opens == 2


class TestSeeks:
    """The only numbers here that matter to a user waiting for an export."""

    def test_a_forward_run_costs_one_seek_not_one_a_frame(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1") as pool:
            pool.pictures([_request(frame=n) for n in range(30)])
        assert pool.stats.seeks == 1
        assert decoder.total_seeks == 1

    def test_a_jump_backwards_costs_another_seek(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1") as pool:
            pool.pictures([_request(frame=n) for n in (0, 1, 2, 20, 21)])
        assert pool.stats.seeks == 2

    def test_asking_for_a_frame_twice_costs_nothing(self) -> None:
        """Scrubbing back to where you were must not re-decode a GOP."""
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pool.pictures([_request(frame=5)])
            pool.pictures([_request(frame=5)])
        assert pool.stats.hits == 1
        assert pool.stats.misses == 1
        assert decoder.total_seeks == 1

    def test_two_assets_read_forward_in_parallel_cost_one_each(self) -> None:
        """Interleaving two clips is not a jump: each stream keeps its own run."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(), "a2.mp4": FakeClip()})
        requests = [_request(asset, n) for n in range(4) for asset in ("a1", "a2")]
        with _pool(decoder, "a1", "a2") as pool:
            pool.pictures(requests)
        assert pool.stats.seeks == 2


class TestTheCache:
    def test_the_cache_is_measured_in_bytes_not_frames(self) -> None:
        """A cache of '64 frames' is a rounding error at 720p and a third of the
        machine at 4K. Budget the pixels."""
        one_frame = 8 * 6 * 3
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1", cache_bytes=one_frame * 4) as pool:
            pool.pictures([_request(frame=n) for n in range(30)])
            assert pool.cached_bytes <= one_frame * 4

    def test_a_frame_larger_than_the_whole_cache_is_not_cached(self) -> None:
        """Caching it would empty the cache and be evicted by the next one."""
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1", cache_bytes=8) as pool:
            pool.pictures([_request(frame=1)])
        assert pool.cached_bytes == 0

    def test_the_oldest_frame_goes_first(self) -> None:
        one_frame = 8 * 6 * 3
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1", cache_bytes=one_frame * 2) as pool:
            pool.pictures([_request(frame=0)])
            pool.pictures([_request(frame=1)])
            assert pool.pictures([_request(frame=0)]).popitem()[1] is not None  # still there
            pool.pictures([_request(frame=2)])  # pushes frame 0 out
            assert pool.stats.hits == 1  # frame 0 was served from the cache once

    def test_editing_the_timeline_drops_the_pictures_but_not_the_decoders(self) -> None:
        """The pictures on screen are of a timeline that no longer exists."""
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pool.pictures([_request(frame=0)])
            pool.clear_cache()
            assert pool.cached_bytes == 0
            assert pool.open_sources == 1


class TestOpenSources:
    def test_decoders_are_evicted_least_recently_used(self) -> None:
        decoder = FakeDecoder({f"a{n}.mp4": FakeClip() for n in (1, 2, 3)})
        with _pool(decoder, "a1", "a2", "a3", capacity=2) as pool:
            pool.pictures([_request("a1")])
            pool.pictures([_request("a2")])
            pool.pictures([_request("a3")])  # pushes a1 out
            assert pool.open_sources == 2
            assert pool.stats.closes == 1
            assert decoder.opened[0].is_closed is True
            assert decoder.opened[2].is_closed is False

    def test_using_a_source_keeps_it(self) -> None:
        """Least *recently used*: touching a1 before a3 saves a1."""
        decoder = FakeDecoder({f"a{n}.mp4": FakeClip() for n in (1, 2, 3)})
        with _pool(decoder, "a1", "a2", "a3", capacity=2) as pool:
            pool.pictures([_request("a1")])
            pool.pictures([_request("a2")])
            pool.pictures([_request("a1")])  # a1 is now the most recent
            pool.pictures([_request("a3")])  # pushes a2 out
            assert decoder.opened[1].is_closed is True
            assert decoder.opened[0].is_closed is False

    def test_closing_releases_everything_and_twice_is_fine(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        pool = _pool(decoder, "a1")
        pool.pictures([_request(frame=0)])
        pool.close()
        pool.close()
        assert pool.open_sources == 0
        assert pool.cached_bytes == 0
        assert decoder.opened[0].is_closed is True

    def test_a_pool_of_nothing_is_refused(self) -> None:
        with pytest.raises(Exception, match="capacity"):
            FrameSourcePool(FakeDecoder(), _resolve("a1"), capacity=0)


class TestFailure:
    """A render that meets one bad file must not lose the other two hours."""

    def test_an_unresolvable_asset_is_a_gap_with_an_error(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            assert pool.pictures([_request("a9")]) == {}
            assert pool.errors()[0].code == MediaErrorCode.UNREADABLE
            assert pool.stats.gaps == 1

    def test_a_missing_asset_is_remembered_not_reasked(self) -> None:
        """A render asks once per frame; resolving again would be a stat a frame."""
        resolve, asked = _counting_resolve("a1")
        pool = FrameSourcePool(FakeDecoder({"a1.mp4": FakeClip()}), resolve)
        with pool:
            pool.pictures([_request("a9")])
            pool.pictures([_request("a9")])
            pool.pictures([_request("a9")])
        assert asked == ["a9"]

    def test_a_file_that_will_not_open_records_its_error(self) -> None:
        broken = FakeClip(error=NovaError(MediaErrorCode.UNSUPPORTED, "no decoder for this"))
        decoder = FakeDecoder({"a1.mp4": broken})
        with _pool(decoder, "a1") as pool:
            assert pool.pictures([_request(frame=0)]) == {}
            assert pool.errors()[0].code == MediaErrorCode.UNSUPPORTED

    def test_a_file_with_no_picture_in_it_is_reported(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(video_streams=0)})
        with _pool(decoder, "a1") as pool:
            assert pool.pictures([_request(frame=0)]) == {}
            assert pool.errors()[0].code == MediaErrorCode.UNSUPPORTED

    def test_damage_mid_stream_is_latched_and_the_frames_before_it_survive(self) -> None:
        """'This clip is damaged at 00:03:12' — the frames before it are fine."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30, damaged_from=4)})
        with _pool(decoder, "a1") as pool:
            pictures = pool.pictures([_request(frame=n) for n in range(3)])
            assert sorted(_grey(p) for p in pictures.values()) == [0, 1, 2]
            assert pool.pictures([_request(frame=6)]) == {}
            assert pool.errors()[0].code == MediaErrorCode.DECODE_FAILED

    def test_one_error_is_recorded_once(self) -> None:
        """A hundred thousand copies of the same sentence is not a summary."""
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30, damaged_from=0)})
        with _pool(decoder, "a1") as pool:
            for frame in range(10):
                pool.pictures([_request(frame=frame)])
        assert len(pool.errors()) == 1

    def test_a_gap_does_not_stop_the_other_assets(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pictures = pool.pictures([_request("a9"), _request("a1", 3)])
        assert _grey(pictures[_request("a1", 3).key]) == 3


class TestWarming:
    def test_prefetch_answers_nothing_and_decodes_anyway(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
        with _pool(decoder, "a1") as pool:
            assert pool.prefetch([_request(frame=n) for n in range(10)]) is None
            assert pool.cached_bytes > 0
            assert pool.pictures([_request(frame=4)])[_request(frame=4).key] is not None
            assert pool.stats.hits == 1

    def test_prefetching_what_is_already_cached_costs_nothing(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip()})
        with _pool(decoder, "a1") as pool:
            pool.prefetch([_request(frame=2)])
            pool.prefetch([_request(frame=2)])
        assert decoder.total_seeks == 1

    def test_keyframes_come_from_the_stream(self) -> None:
        decoder = FakeDecoder({"a1.mp4": FakeClip(keyframes=(0, 12, 24))})
        with _pool(decoder, "a1") as pool:
            assert pool.keyframes("a1", "original") == (0, 12, 24)

    def test_keyframes_of_an_asset_that_is_not_there_is_empty(self) -> None:
        with _pool(FakeDecoder(), "a1") as pool:
            assert pool.keyframes("a9", "original") == ()


def test_the_stats_add_up() -> None:
    """What a perf report reads: opens, closes, seeks, hits, misses, gaps."""
    decoder = FakeDecoder({"a1.mp4": FakeClip(frame_count=30)})
    with _pool(decoder, "a1") as pool:
        pool.pictures([_request(frame=0), _request(frame=1), _request(frame=0)])
    stats = pool.stats
    assert (stats.opens, stats.seeks, stats.hits, stats.misses) == (1, 1, 1, 2)
