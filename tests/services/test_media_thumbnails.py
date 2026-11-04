"""The thumbnail plan (`services/media/thumbnails.py`).

A strip of eight from a ten-minute 4K clip is eight seeks. Done naively, each
one walks a group of pictures forward from the last keyframe; done this way,
each one lands on a keyframe and costs a single decode. That is the whole point
of the module, and it is why these tests are pure arithmetic: no decoder, no
filesystem, microseconds.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.services.media import DEFAULT_STRIP_COUNT, thumbnail_indices
from nova_studio.services.media.thumbnails import snap_to_keyframe

pytestmark = pytest.mark.unit


class TestTheSpread:
    def test_a_strip_starts_at_the_first_frame(self) -> None:
        assert thumbnail_indices(1000, wanted=8)[0] == 0

    def test_a_strip_reaches_the_end_of_the_clip(self) -> None:
        indices = thumbnail_indices(1000, wanted=8)
        assert indices[-1] == 875  # floor(7 * 1000 / 8)

    def test_a_strip_is_spread_evenly(self) -> None:
        assert thumbnail_indices(800, wanted=8) == (0, 100, 200, 300, 400, 500, 600, 700)

    def test_the_indices_ascend(self) -> None:
        indices = thumbnail_indices(10_000, wanted=17)
        assert indices == tuple(sorted(indices))

    def test_every_index_is_inside_the_clip(self) -> None:
        assert all(0 <= index < 997 for index in thumbnail_indices(997, wanted=13))

    def test_asking_for_more_than_there_are_gives_every_frame(self) -> None:
        assert thumbnail_indices(3, wanted=10) == (0, 1, 2)

    def test_asking_for_one_gives_the_first_frame(self) -> None:
        assert thumbnail_indices(1000, wanted=1) == (0,)

    def test_a_single_frame_clip_gives_that_frame(self) -> None:
        """A still image: there is nothing else to show."""
        assert thumbnail_indices(1, wanted=8) == (0,)

    def test_a_clip_with_no_frames_gives_nothing(self) -> None:
        assert thumbnail_indices(0, wanted=8) == ()

    def test_the_default_strip_is_eight(self) -> None:
        assert len(thumbnail_indices(1000)) == DEFAULT_STRIP_COUNT

    def test_the_same_clip_gives_the_same_strip_every_time(self) -> None:
        """A stable plan is what makes a disposable thumbnail cache useful."""
        assert thumbnail_indices(4321, wanted=9) == thumbnail_indices(4321, wanted=9)


class TestLandingOnAKeyframe:
    def test_a_target_snaps_back_to_the_keyframe_before_it(self) -> None:
        assert thumbnail_indices(100, wanted=4, keyframes=(0, 30, 60, 90))[2] == 60

    def test_snapping_never_moves_forward(self) -> None:
        """Forward would show a frame the user has not scrubbed to."""
        assert snap_to_keyframe(50, (0, 30, 90)) == 30

    def test_a_frame_before_the_first_keyframe_is_its_own_landing(self) -> None:
        assert snap_to_keyframe(5, (10, 20)) == 5

    def test_a_keyframe_is_its_own_landing(self) -> None:
        assert snap_to_keyframe(60, (0, 30, 60)) == 60

    def test_unsorted_keyframes_are_still_usable(self) -> None:
        assert thumbnail_indices(100, wanted=4, keyframes=(90, 0, 60, 30))[2] == 60

    def test_a_keyframe_past_the_end_is_ignored(self) -> None:
        assert thumbnail_indices(100, wanted=4, keyframes=(0, 30, 500))[-1] == 30

    def test_duplicate_keyframes_do_not_duplicate_the_strip(self) -> None:
        assert thumbnail_indices(100, wanted=4, keyframes=(0, 0, 30, 30)) == (0, 30)

    def test_two_targets_that_land_together_give_one_thumbnail(self) -> None:
        """Fewer, cheaper thumbnails beat two identical decodes."""
        assert thumbnail_indices(100, wanted=8, keyframes=(0, 50)) == (0, 50)

    def test_a_negative_index_is_a_bug_in_the_caller(self) -> None:
        with pytest.raises(NovaInvariantError):
            snap_to_keyframe(-1, (0, 10))


class TestBadArguments:
    def test_a_negative_frame_count_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            thumbnail_indices(-1)

    def test_asking_for_nothing_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            thumbnail_indices(100, wanted=0)

    def test_a_negative_want_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            thumbnail_indices(100, wanted=-3)
