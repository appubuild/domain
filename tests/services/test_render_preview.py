"""The preview plan (`services/render/preview.py`).

The preview is where a renderer is most tempted to guess — a widget that picks
its own size, rounds its own way, and quietly crops a corner. These tests pin
the three rules that stop that: **contain, not cover**; **never above native**
unless the user zooms; and **even dimensions**, because every 4:2:0 encoder we
ship refuses an odd one.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.services.render.preview import (
    DEFAULT_WARM_COUNT,
    PreviewPlan,
    Viewport,
    fit_scale,
    plan_preview,
    preview_size,
    warm_frames,
)

pytestmark = pytest.mark.unit

PANEL = Viewport(width=800, height=450)
SQUARE = Viewport(width=600, height=600)


class TestTheViewport:
    def test_a_panel_has_an_aspect(self) -> None:
        assert Viewport(width=800, height=400).aspect_ratio == 2.0

    def test_a_zero_sized_panel_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            Viewport(width=0, height=100)

    def test_a_negative_panel_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            Viewport(width=800, height=-10)


class TestFitting:
    def test_a_frame_that_fits_exactly_is_drawn_at_native(self) -> None:
        assert fit_scale(800, 450, PANEL) == 1.0

    def test_a_bigger_frame_is_scaled_down(self) -> None:
        assert fit_scale(1920, 1080, PANEL) == pytest.approx(800 / 1920)

    def test_the_smaller_axis_decides(self) -> None:
        """Contain, not cover: the whole frame has to be visible."""
        assert fit_scale(1920, 1080, SQUARE) == pytest.approx(600 / 1920)

    def test_a_smaller_frame_is_never_enlarged(self) -> None:
        """Pixels above 1:1 are not information."""
        assert fit_scale(320, 180, PANEL) == 1.0

    def test_an_ultrawide_frame_is_limited_by_its_width(self) -> None:
        assert fit_scale(3200, 800, Viewport(width=800, height=800)) == pytest.approx(0.25)

    def test_a_zero_sized_source_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            fit_scale(0, 1080, PANEL)


class TestThePreviewSize:
    def test_a_1080p_frame_in_a_half_size_panel_is_960_by_540(self) -> None:
        assert preview_size(1920, 1080, Viewport(width=960, height=540)) == (960, 540)

    def test_both_dimensions_are_even(self) -> None:
        """4:2:0 chroma subsampling cannot represent an odd dimension."""
        width, height = preview_size(1920, 1080, Viewport(width=961, height=541))
        assert (width % 2, height % 2) == (0, 0)

    def test_the_size_never_exceeds_the_panel(self) -> None:
        width, height = preview_size(1920, 1080, Viewport(width=333, height=187))
        assert (width, height) <= (333, 187)

    def test_a_very_small_panel_still_gets_a_usable_size(self) -> None:
        assert preview_size(1920, 1080, Viewport(width=3, height=3)) == (2, 2)

    def test_zoom_can_go_above_native(self) -> None:
        """A user who asks for 200 % means 200 % of the source, not of the panel."""
        assert preview_size(1920, 1080, Viewport(width=4000, height=3000), zoom=2.0) == (
            3840,
            2160,
        )

    def test_zoom_multiplies_the_fitted_scale(self) -> None:
        assert preview_size(1920, 1080, PANEL, zoom=0.5) == (400, 224)

    def test_a_non_positive_zoom_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            preview_size(1920, 1080, PANEL, zoom=0.0)


class TestWarmingUp:
    def test_the_default_is_a_handful_of_frames(self) -> None:
        assert len(warm_frames(0)) == DEFAULT_WARM_COUNT

    def test_warming_starts_after_the_playhead(self) -> None:
        assert warm_frames(10, count=3) == (11, 12, 13)

    def test_warming_never_looks_backwards(self) -> None:
        """The user is moving forward; work behind them is wasted work."""
        assert all(frame > 10 for frame in warm_frames(10, count=5))

    def test_warming_stops_at_the_end_of_the_timeline(self) -> None:
        assert warm_frames(98, count=10, last_frame=100) == (99, 100)

    def test_nothing_to_warm_at_the_end(self) -> None:
        assert warm_frames(100, count=10, last_frame=100) == ()

    def test_asking_for_nothing_warms_nothing(self) -> None:
        assert warm_frames(0, count=0) == ()

    def test_an_empty_timeline_warms_nothing(self) -> None:
        assert warm_frames(0, count=10, last_frame=0) == ()

    def test_a_negative_playhead_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            warm_frames(-1)

    def test_a_negative_count_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            warm_frames(0, count=-1)


class TestThePreviewPlan:
    def test_a_plan_names_the_frame(self) -> None:
        assert plan_preview(1920, 1080, PANEL, frame=42).frame == 42

    def test_a_plan_carries_the_size(self) -> None:
        assert plan_preview(1920, 1080, PANEL).size == (800, 450)

    def test_a_plan_carries_the_scale_the_media_layer_asks_about(self) -> None:
        """This number is what decides original versus proxy — in §5, not here."""
        assert plan_preview(1920, 1080, PANEL).scale == pytest.approx(800 / 1920)

    def test_a_fitting_frame_has_no_bars(self) -> None:
        assert plan_preview(1920, 1080, PANEL).is_letterboxed is False

    def test_a_mismatched_frame_is_centred(self) -> None:
        plan = plan_preview(1920, 1080, SQUARE)
        assert plan.offset == (0, (600 - plan.height) // 2)

    def test_the_bars_are_even_on_both_sides(self) -> None:
        plan = plan_preview(1920, 1080, SQUARE)
        top, bottom = plan.offset[1], 600 - plan.height - plan.offset[1]
        assert abs(top - bottom) <= 1

    def test_a_plan_carries_its_warm_up(self) -> None:
        assert plan_preview(1920, 1080, PANEL, frame=10, warm_count=3, last_frame=50).warm == (
            11,
            12,
            13,
        )

    def test_a_plan_exposes_its_size_as_two_numbers(self) -> None:
        plan = plan_preview(1920, 1080, PANEL)
        assert (plan.width, plan.height) == plan.size

    def test_the_plan_is_a_value(self) -> None:
        assert isinstance(plan_preview(1920, 1080, PANEL), PreviewPlan)

    def test_two_identical_asks_give_the_same_plan(self) -> None:
        assert plan_preview(1920, 1080, PANEL, frame=7) == plan_preview(1920, 1080, PANEL, frame=7)

    def test_zooming_in_crops_rather_than_shrinking(self) -> None:
        """A zoomed frame is bigger than the panel; the caller scrolls it."""
        plan = plan_preview(1920, 1080, Viewport(width=1920, height=1080), zoom=2.0)
        assert plan.size == (3840, 2160)
        assert plan.is_cropped is True
        assert plan.is_letterboxed is False

    def test_a_zoomed_frame_is_centred_on_the_same_point(self) -> None:
        plan = plan_preview(1920, 1080, Viewport(width=1920, height=1080), zoom=2.0)
        assert plan.offset == (-(3840 - 1920) // 2, -(2160 - 1080) // 2)

    def test_a_fitted_frame_is_neither_cropped_nor_barred(self) -> None:
        plan = plan_preview(1920, 1080, Viewport(width=1920, height=1080))
        assert (plan.is_cropped, plan.is_letterboxed) == (False, False)
