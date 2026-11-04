"""The colour grade (`domain/grade.py`).

What is pinned here is what an editor gets wrong when it is rebuilt in a hurry:

* **A curve is a function of the whole range.**  It starts at x=0, ends at x=1
  and never bends past a control point, because a spline that overshoots turns a
  gentle S-curve into a band of inverted contrast exactly where the user was
  being careful.  The tangents are Fritsch–Carlson, not Catmull-Rom, and the
  tests pin monotonicity on the shapes that would break a naive spline.
* **Neutral is zero.**  Every correction is 0-neutral, so a default grade is a
  grade that does nothing — and "does nothing" is a question the compositor
  asks per frame, because most clips in most projects are ungraded.
* **A grade is animatable like everything else.**  The same ``Animatable`` an
  effect parameter uses, so riding the exposure across a shot is not a different
  object from setting it once.
* **A missing LUT is not a broken grade.**  It is a reference, so a project
  whose LUT is uninstalled opens with the rest of its look intact.
"""

from __future__ import annotations

import json
from itertools import pairwise
from typing import Any

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.domain.animation import Animatable, Keyframe
from nova_studio.domain.grade import (
    BALANCE_LIMIT,
    CONTRAST_LIMIT,
    DEFAULT_LUT_SIZE,
    EXPOSURE_LIMIT,
    MAX_CURVE_POINTS,
    SATURATION_LIMIT,
    SUPPORTED_LUT_SIZES,
    WHEEL_LIMIT,
    ColourGrade,
    CurveChannel,
    GradeCurve,
    GradeSample,
    Lut,
    validate_grade,
)

pytestmark = pytest.mark.unit


# -- builders -----------------------------------------------------------------


def _curve(*points: tuple[float, float], **over: Any) -> GradeCurve:
    """A curve; with no points, the straight line a user has not touched."""
    defaults: dict[str, Any] = {"points": points or ((0.0, 0.0), (1.0, 1.0))}
    return GradeCurve(**{**defaults, **over})


def _grade(**over: Any) -> ColourGrade:
    return ColourGrade(**over)


def _round_trip(wire: object) -> object:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestGradeCurve:
    def test_the_default_curve_does_nothing(self) -> None:
        assert GradeCurve().is_identity is True

    def test_a_straight_line_between_the_corners_is_the_identity(self) -> None:
        assert _curve((0.0, 0.0), (1.0, 1.0)).is_identity is True

    def test_a_curve_that_bends_is_not_the_identity(self) -> None:
        assert _curve((0.0, 0.0), (0.5, 0.25), (1.0, 1.0)).is_identity is False

    def test_a_single_point_is_not_a_curve(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least two points"):
            _curve((0.5, 0.5))

    def test_a_curve_holds_a_bounded_number_of_points(self) -> None:
        """A hundred control points is a hundred decisions a user did not make."""
        points = [(index / 40, index / 40) for index in range(MAX_CURVE_POINTS + 1)]
        with pytest.raises(NovaInvariantError, match="at most"):
            _curve(*points)

    def test_a_curve_must_start_at_zero(self) -> None:
        with pytest.raises(NovaInvariantError, match="must start at x=0"):
            _curve((0.1, 0.1), (1.0, 1.0))

    def test_a_curve_must_end_at_one(self) -> None:
        with pytest.raises(NovaInvariantError, match="must start at x=0"):
            _curve((0.0, 0.0), (0.9, 0.9))

    def test_a_point_outside_the_range_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="within"):
            _curve((0.0, 0.0), (0.5, 1.2), (1.0, 1.0))

    def test_a_curve_must_run_left_to_right(self) -> None:
        with pytest.raises(NovaInvariantError, match="to the right of"):
            _curve((0.0, 0.0), (0.6, 0.4), (0.5, 0.5), (1.0, 1.0))

    def test_two_points_may_not_share_an_x(self) -> None:
        with pytest.raises(NovaInvariantError, match="to the right of"):
            _curve((0.0, 0.0), (0.5, 0.4), (0.5, 0.6), (1.0, 1.0))

    def test_the_identity_curve_is_the_identity_function(self) -> None:
        assert GradeCurve().at(0.37) == pytest.approx(0.37)

    def test_the_ends_are_held(self) -> None:
        assert GradeCurve().at(0.0) == 0.0
        assert GradeCurve().at(1.0) == 1.0

    def test_a_value_before_the_curve_holds_the_first_point(self) -> None:
        assert _curve((0.0, 0.1), (1.0, 0.9)).at(-0.5) == pytest.approx(0.1)

    def test_a_value_after_the_curve_holds_the_last_point(self) -> None:
        assert _curve((0.0, 0.1), (1.0, 0.9)).at(1.5) == pytest.approx(0.9)

    def test_the_curve_passes_through_every_control_point(self) -> None:
        curve = _curve((0.0, 0.0), (0.25, 0.1), (0.75, 0.9), (1.0, 1.0))
        for x, y in curve.points:
            assert curve.at(x) == pytest.approx(y)

    def test_three_collinear_points_stay_linear(self) -> None:
        """A curve drawn as a straight line must evaluate as one, or a user's
        'no change' reads as a grade."""
        curve = _curve((0.0, 0.0), (0.5, 0.5), (1.0, 1.0))
        assert curve.at(0.25) == pytest.approx(0.25)

    def test_a_curve_never_overshoots_a_control_point(self) -> None:
        """The shape the user sees is the shape they get: a plain spline would
        bend above 0.91 between these two points."""
        curve = _curve((0.0, 0.0), (0.5, 0.9), (0.55, 0.91), (1.0, 1.0))
        assert all(curve.at(0.5 + i / 1000) <= 0.91 + 1e-9 for i in range(51))

    def test_an_s_curve_is_monotone(self) -> None:
        curve = _curve((0.0, 0.0), (0.25, 0.2), (0.75, 0.8), (1.0, 1.0))
        values = [curve.at(index / 20) for index in range(21)]
        assert all(later >= earlier for earlier, later in pairwise(values))

    def test_an_s_curve_lifts_the_highlights_and_holds_the_shadows(self) -> None:
        curve = _curve((0.0, 0.0), (0.5, 0.6), (1.0, 1.0))
        assert curve.at(0.5) == pytest.approx(0.6)

    def test_a_curve_is_clamped_to_the_range(self) -> None:
        """Clipping is the output transform's business, not the authoring
        model's, so a curve cannot ask for a value outside 0-1."""
        curve = _curve((0.0, 0.0), (0.5, 0.99), (0.6, 0.01), (1.0, 1.0))
        assert 0.0 <= curve.at(0.55) <= 1.0

    def test_a_non_finite_position_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be finite"):
            GradeCurve().at(float("nan"))

    def test_the_channel_travels_with_the_curve(self) -> None:
        assert _curve((0.0, 0.0), (1.0, 1.0), channel=CurveChannel.RED).channel is (
            CurveChannel.RED
        )

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        curve = _curve((0.0, 0.0), (0.5, 0.25), (1.0, 1.0), channel=CurveChannel.BLUE)
        assert GradeCurve.from_wire(_round_trip(curve.to_wire())) == curve

    def test_the_wire_form_is_readable(self) -> None:
        """A support engineer unzips the project and reads this by hand."""
        assert GradeCurve().to_wire()["points"] == [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}]

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            GradeCurve.from_wire(dict(GradeCurve().to_wire(), tension=0.5))


class TestLut:
    def test_a_lut_needs_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="must carry an id"):
            Lut(lut_id="")

    def test_the_default_size_is_33_samples(self) -> None:
        assert Lut(lut_id="teal").size == DEFAULT_LUT_SIZE

    @pytest.mark.parametrize("size", sorted(SUPPORTED_LUT_SIZES))
    def test_every_supported_size_is_accepted(self, size: int) -> None:
        assert Lut(lut_id="teal", size=size).size == size

    def test_an_unsupported_size_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="samples per axis"):
            Lut(lut_id="teal", size=64)

    def test_a_lut_is_a_reference_and_not_a_file(self) -> None:
        """Missing media is a state: a project whose LUT is uninstalled opens
        with the rest of its grade intact."""
        assert Lut(lut_id="teal", path="").path == ""

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        lut = Lut(lut_id="teal-orange", name="Teal & Orange", path="D:/Luts/teal.cube")
        assert Lut.from_wire(_round_trip(lut.to_wire())) == lut

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Lut.from_wire(dict(Lut(lut_id="teal").to_wire(), strength=0.5))


class TestColourGrade:
    def test_the_default_grade_does_nothing(self) -> None:
        assert _grade().is_neutral is True

    def test_the_default_grade_is_static(self) -> None:
        assert _grade().is_static is True

    def test_the_default_grade_starts_enabled(self) -> None:
        assert _grade().enabled is True

    def test_a_scalar_correction_is_one_component(self) -> None:
        with pytest.raises(NovaInvariantError, match="must hold 1 components"):
            _grade(exposure=Animatable.constant("exposure", 0.0, 0.0))

    def test_a_wheel_is_three_components(self) -> None:
        with pytest.raises(NovaInvariantError, match="must hold 3 components"):
            _grade(lift=Animatable.constant("lift", 0.0))

    def test_one_curve_per_channel(self) -> None:
        curves = (
            _curve(channel=CurveChannel.RED),
            _curve((0.0, 0.0), (0.5, 0.5), (1.0, 1.0), channel=CurveChannel.RED),
        )
        with pytest.raises(NovaInvariantError, match="one red curve"):
            _grade(curves=curves)

    def test_four_channels_may_each_have_a_curve(self) -> None:
        curves = tuple(_curve(channel=channel) for channel in CurveChannel)
        assert len(_grade(curves=curves).curves) == 4

    def test_a_grade_with_a_correction_is_not_neutral(self) -> None:
        assert _grade(exposure=Animatable.constant("exposure", 1.0)).is_neutral is False

    def test_a_grade_with_a_curve_is_not_neutral(self) -> None:
        curve = _curve((0.0, 0.0), (0.5, 0.6), (1.0, 1.0))
        assert _grade(curves=(curve,)).is_neutral is False

    def test_a_grade_with_identity_curves_is_still_neutral(self) -> None:
        assert _grade(curves=(_curve(), _curve(channel=CurveChannel.RED))).is_neutral is True

    def test_a_lut_at_full_strength_is_not_neutral(self) -> None:
        assert _grade(lut=Lut(lut_id="teal")).is_neutral is False

    def test_a_lut_turned_down_to_nothing_is_neutral(self) -> None:
        """Bypassing a LUT while dialling a look in is the normal workflow."""

        grade = _grade(
            lut=Lut(lut_id="teal"), lut_strength=Animatable.constant("lut_strength", 0.0)
        )
        assert grade.is_neutral is True

    def test_a_disabled_grade_is_neutral(self) -> None:
        grade = _grade(exposure=Animatable.constant("exposure", 2.0), enabled=False)
        assert grade.is_neutral is True

    def test_a_disabled_grade_keeps_its_settings(self) -> None:
        grade = _grade(exposure=Animatable.constant("exposure", 2.0), enabled=False)
        assert grade.at(0).exposure == 2.0

    def test_at_resolves_every_correction(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 1.0),
            contrast=Animatable.constant("contrast", 0.25),
            saturation=Animatable.constant("saturation", -0.5),
            temperature=Animatable.constant("temperature", 0.1),
            tint=Animatable.constant("tint", -0.1),
            lift=Animatable.constant("lift", 0.0, 0.0, 0.2),
            gamma=Animatable.constant("gamma", 0.1, 0.1, 0.1),
            gain=Animatable.constant("gain", 0.0, 0.0, 0.0),
        )
        sample = grade.at(0)
        assert (
            sample.exposure,
            sample.contrast,
            sample.saturation,
            sample.temperature,
            sample.tint,
        ) == (1.0, 0.25, -0.5, 0.1, -0.1)
        assert sample.lift == (0.0, 0.0, 0.2)
        assert sample.gamma == (0.1, 0.1, 0.1)

    def test_at_carries_the_curves_and_the_lut(self) -> None:
        curve = _curve((0.0, 0.0), (0.5, 0.6), (1.0, 1.0))
        lut = Lut(lut_id="teal")
        sample = _grade(curves=(curve,), lut=lut).at(0)
        assert sample.curves == (curve,)
        assert sample.lut == lut

    def test_a_static_grade_reads_the_same_at_every_frame(self) -> None:
        grade = _grade(exposure=Animatable.constant("exposure", 0.5))
        assert grade.at(0) == grade.at(999)

    def test_an_animated_grade_changes_over_time(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0)
            .with_keyframe(Keyframe.at(0, 0.0))
            .with_keyframe(Keyframe.at(10, 2.0))
        )
        assert grade.at(0).exposure == pytest.approx(0.0)
        assert grade.at(10).exposure == pytest.approx(2.0)

    def test_an_animated_grade_is_not_static(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0)
            .with_keyframe(Keyframe.at(0, 0.0))
            .with_keyframe(Keyframe.at(10, 2.0))
        )
        assert grade.is_static is False

    def test_one_keyframe_pins_a_value_and_so_is_static(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0).with_keyframe(Keyframe.at(5, 1.0))
        )
        assert grade.is_static is True

    def test_shifting_moves_every_keyframe(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0)
            .with_keyframe(Keyframe.at(0, 0.0))
            .with_keyframe(Keyframe.at(10, 2.0))
        )
        assert grade.shifted(5).exposure.frames == (5, 15)

    def test_shifting_leaves_a_static_grade_alone(self) -> None:
        grade = _grade(exposure=Animatable.constant("exposure", 0.5))
        assert grade.shifted(5) == grade

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 1.5),
            lift=Animatable.constant("lift", 0.0, 0.1, 0.2),
            curves=(_curve((0.0, 0.0), (0.5, 0.6), (1.0, 1.0)),),
            lut=Lut(lut_id="teal", name="Teal"),
        )
        assert ColourGrade.from_wire(_round_trip(grade.to_wire())) == grade

    def test_a_grade_with_no_lut_round_trips(self) -> None:
        assert ColourGrade.from_wire(_round_trip(_grade().to_wire())) == _grade()

    def test_an_animated_grade_round_trips(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0)
            .with_keyframe(Keyframe.at(0, 0.0))
            .with_keyframe(Keyframe.at(10, 2.0))
        )
        assert ColourGrade.from_wire(_round_trip(grade.to_wire())) == grade

    def test_a_disabled_grade_round_trips(self) -> None:
        assert ColourGrade.from_wire(_round_trip(_grade(enabled=False).to_wire())).enabled is (
            False
        )

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            ColourGrade.from_wire(dict(_grade().to_wire(), shadows=0.5))

    def test_a_missing_wire_field_is_refused(self) -> None:
        wire = dict(_grade().to_wire())
        del wire["exposure"]
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            ColourGrade.from_wire(wire)

    def test_a_non_mapping_section_is_refused(self) -> None:
        wire = dict(_grade().to_wire(), exposure="one stop")
        with pytest.raises(NovaInvariantError, match="must be a mapping"):
            ColourGrade.from_wire(wire)


class TestGradeSample:
    def test_the_default_sample_does_nothing(self) -> None:
        assert GradeSample().is_neutral is True

    def test_any_correction_makes_it_work(self) -> None:
        assert GradeSample(exposure=0.1).is_neutral is False

    def test_a_wheel_makes_it_work(self) -> None:
        assert GradeSample(gain=(0.0, 0.0, 0.1)).is_neutral is False

    def test_a_curve_makes_it_work(self) -> None:
        sample = GradeSample(curves=(_curve((0.0, 0.0), (0.5, 0.6), (1.0, 1.0)),))
        assert sample.is_neutral is False

    def test_a_lut_makes_it_work(self) -> None:
        assert GradeSample(lut=Lut(lut_id="teal")).is_neutral is False

    def test_a_lut_turned_down_is_free(self) -> None:
        assert GradeSample(lut=Lut(lut_id="teal"), lut_strength=0.0).is_neutral is True

    def test_the_default_lut_strength_is_full(self) -> None:
        assert GradeSample().lut_strength == 1.0


class TestValidateGrade:
    def test_a_neutral_grade_has_nothing_to_report(self) -> None:
        assert validate_grade(_grade()) == ""

    def test_exposure_within_the_limit_is_fine(self) -> None:
        assert (
            validate_grade(_grade(exposure=Animatable.constant("exposure", EXPOSURE_LIMIT))) == ""
        )

    def test_exposure_beyond_the_limit_is_reported(self) -> None:
        grade = _grade(exposure=Animatable.constant("exposure", EXPOSURE_LIMIT + 1))
        assert (
            validate_grade(grade)
            == f"exposure must be within [-{EXPOSURE_LIMIT}, {EXPOSURE_LIMIT}], got 5.0"
        )

    def test_a_negative_value_outside_the_limit_is_reported(self) -> None:
        grade = _grade(contrast=Animatable.constant("contrast", -CONTRAST_LIMIT - 1))
        assert "contrast must be within" in validate_grade(grade)

    def test_saturation_outside_the_limit_is_reported(self) -> None:
        grade = _grade(saturation=Animatable.constant("saturation", SATURATION_LIMIT + 0.5))
        assert "saturation must be within" in validate_grade(grade)

    def test_white_balance_outside_the_limit_is_reported(self) -> None:
        grade = _grade(tint=Animatable.constant("tint", BALANCE_LIMIT + 0.25))
        assert "tint must be within" in validate_grade(grade)

    def test_a_wheel_outside_the_limit_is_reported(self) -> None:
        grade = _grade(gain=Animatable.constant("gain", 0.0, 0.0, WHEEL_LIMIT + 0.1))
        assert "gain must be within" in validate_grade(grade)

    def test_a_lut_strength_outside_the_range_is_reported(self) -> None:
        grade = _grade(lut_strength=Animatable.constant("lut_strength", 1.5))
        assert validate_grade(grade) == "lut_strength must be within [0, 1], got 1.5"

    def test_a_keyframe_outside_the_limit_is_still_caught(self) -> None:
        """Construction cannot police taste: a keyframe added later can be
        anything, which is why this is a check and not an invariant."""

        grade = _grade(
            exposure=Animatable.constant("exposure", 0.0).with_keyframe(Keyframe.at(10, 9.0))
        )
        assert "exposure must be within" in validate_grade(grade)

    def test_only_the_first_problem_is_reported(self) -> None:
        grade = _grade(
            exposure=Animatable.constant("exposure", 9.0),
            tint=Animatable.constant("tint", 9.0),
        )
        assert validate_grade(grade).startswith("exposure must be within")
