"""The animation model (`domain/animation.py`).

What is pinned here is what a user sees when it is wrong:

* **A value at a frame is a fact.**  Keyframes sit on integer frames and the
  curve between them is derived, not accumulated, so frame 720 evaluates the
  same in the preview, in the export and here.
* **The curve a keyframe owns is the one leaving it.**  Deleting a keyframe
  changes the easing of the segment *before* it — the rule every editor follows
  and every from-scratch implementation gets backwards.
* **Overshoot is allowed.**  A Bezier handle may leave 0-1 in y; a bounce that
  never leaves the range is not a bounce.  It may not leave it in x, or the
  curve stops being a function of time.
* **Constant and animated are one type**, so touching the stopwatch cannot
  change what a reader has to know about a parameter.

The cubic-bezier reference values are the browser's own, which is the cheapest
possible proof that the solver is right.
"""

from __future__ import annotations

import json

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.domain.animation import (
    BEZIER_LINEAR_IN_HANDLE,
    BEZIER_LINEAR_OUT_HANDLE,
    Animatable,
    Interpolation,
    Keyframe,
    bezier_progress,
    ease,
    interpolate,
)

pytestmark = pytest.mark.unit


def _round_trip(wire: object) -> object:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestEasing:
    def test_linear_is_the_progress_itself(self) -> None:
        assert ease(0.25, Interpolation.LINEAR) == 0.25

    def test_hold_never_leaves_the_left_value(self) -> None:
        assert ease(0.99, Interpolation.HOLD) == 0.0

    def test_ease_in_starts_slowly(self) -> None:
        assert ease(0.25, Interpolation.EASE_IN) == 0.0625

    def test_ease_out_finishes_slowly(self) -> None:
        assert ease(0.25, Interpolation.EASE_OUT) == 0.4375

    def test_ease_in_out_is_symmetric(self) -> None:
        assert ease(0.25, Interpolation.EASE_IN_OUT) == pytest.approx(0.15625)
        assert ease(0.75, Interpolation.EASE_IN_OUT) == pytest.approx(0.84375)

    def test_every_curve_starts_at_zero_and_ends_at_one(self) -> None:
        for curve in (
            Interpolation.LINEAR,
            Interpolation.EASE_IN,
            Interpolation.EASE_OUT,
            Interpolation.EASE_IN_OUT,
        ):
            assert ease(0.0, curve) == 0.0
            assert ease(1.0, curve) == 1.0

    def test_progress_outside_the_segment_is_clamped(self) -> None:
        assert ease(-1.0, Interpolation.LINEAR) == 0.0
        assert ease(2.0, Interpolation.LINEAR) == 1.0

    def test_bezier_cannot_be_evaluated_without_its_handles(self) -> None:
        with pytest.raises(NovaInvariantError, match="control points"):
            ease(0.5, Interpolation.BEZIER)


class TestBezier:
    def test_the_linear_handles_reproduce_a_straight_line(self) -> None:
        """With P1=(1/3,1/3) and P2=(2/3,2/3) the cubic collapses to y = x."""
        assert bezier_progress(0.25, BEZIER_LINEAR_OUT_HANDLE, BEZIER_LINEAR_IN_HANDLE) == (
            pytest.approx(0.25)
        )

    def test_a_css_ease_curve_matches_the_reference_values(self) -> None:
        """cubic-bezier(0.25, 0.1, 0.25, 1.0): the browser's own numbers."""
        handles = ((0.25, 0.1), (0.25, 1.0))
        assert bezier_progress(0.25, *handles) == pytest.approx(0.4085, abs=1e-4)
        assert bezier_progress(0.5, *handles) == pytest.approx(0.8024, abs=1e-4)
        assert bezier_progress(0.75, *handles) == pytest.approx(0.9605, abs=1e-4)

    def test_the_curve_is_pinned_at_both_ends(self) -> None:
        handles = ((0.25, 0.1), (0.25, 1.0))
        assert bezier_progress(0.0, *handles) == 0.0
        assert bezier_progress(1.0, *handles) == 1.0

    def test_a_handle_above_one_overshoots(self) -> None:
        """The bounce an editor user is actually asking for."""
        handles = ((0.5, 1.4), (0.5, 1.4))
        assert bezier_progress(0.5, *handles) == pytest.approx(1.175, abs=1e-3)
        assert bezier_progress(0.75, *handles) > 1.0

    def test_the_curve_is_monotonic_in_time(self) -> None:
        handles = ((0.25, 0.1), (0.25, 1.0))
        samples = [bezier_progress(step / 20, *handles) for step in range(21)]
        assert samples == sorted(samples)

    def test_progress_outside_the_segment_is_clamped(self) -> None:
        handles = ((0.25, 0.1), (0.25, 1.0))
        assert bezier_progress(-1.0, *handles) == 0.0
        assert bezier_progress(2.0, *handles) == 1.0

    def test_a_flat_curve_still_solves(self) -> None:
        """Newton-Raphson has no slope to work with here; bisection finishes it."""
        assert bezier_progress(0.5, (0.0, 0.0), (1.0, 1.0)) == pytest.approx(0.5, abs=1e-3)


class TestKeyframe:
    def test_a_keyframe_pins_a_value_to_a_frame(self) -> None:
        keyframe = Keyframe.at(24, 0.5)
        assert (keyframe.frame, keyframe.value) == (24, (0.5,))

    def test_a_value_can_have_several_components(self) -> None:
        assert Keyframe.at(0, 1.0, 2.0).value == (1.0, 2.0)

    def test_the_default_curve_is_linear(self) -> None:
        assert Keyframe.at(0, 0.0).interpolation is Interpolation.LINEAR

    def test_hold_jumps_rather_than_eases(self) -> None:
        assert Keyframe.hold(0, 0.0).interpolation is Interpolation.HOLD

    def test_a_frame_is_never_negative(self) -> None:
        with pytest.raises(NovaInvariantError, match="frame"):
            Keyframe.at(-1, 0.0)

    def test_a_value_must_have_something_in_it(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least one"):
            Keyframe(frame=0, value=())

    def test_a_value_must_be_a_tuple(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a tuple"):
            Keyframe(frame=0, value=[0.5])  # type: ignore[arg-type]

    def test_a_value_must_be_finite(self) -> None:
        with pytest.raises(NovaInvariantError, match="finite"):
            Keyframe.at(0, float("nan"))

    def test_a_bezier_handle_must_stay_a_function_of_time(self) -> None:
        with pytest.raises(NovaInvariantError, match="out_handle x"):
            Keyframe.at(0, 0.0, out_handle=(1.5, 0.5))

    def test_a_handle_may_leave_the_range_in_value(self) -> None:
        assert Keyframe.at(0, 0.0, out_handle=(0.5, 1.4)).out_handle == (0.5, 1.4)

    def test_a_handle_is_two_numbers(self) -> None:
        with pytest.raises(NovaInvariantError, match="two numbers"):
            Keyframe.at(0, 0.0, out_handle=(0.5,))  # type: ignore[arg-type]

    def test_bezier_is_recognised(self) -> None:
        assert Keyframe.at(0, 0.0, interpolation=Interpolation.BEZIER).is_bezier

    def test_a_keyframe_survives_json(self) -> None:
        keyframe = Keyframe.at(
            12,
            0.25,
            interpolation=Interpolation.BEZIER,
            out_handle=(0.25, 0.1),
            in_handle=(0.25, 1.0),
        )
        assert Keyframe.from_wire(_round_trip(keyframe.to_wire())) == keyframe

    def test_a_wire_keyframe_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Keyframe.from_wire(dict(Keyframe.at(0, 0.0).to_wire(), extra=1))


class TestAnimatable:
    def test_a_constant_parameter_never_changes(self) -> None:
        parameter = Animatable.constant("opacity", 1.0)
        assert parameter.at(0) == (1.0,)
        assert parameter.at(10_000) == (1.0,)
        assert not parameter.is_animated

    def test_the_arity_comes_from_the_value(self) -> None:
        assert Animatable.constant("position", 0.0, 0.0).width == 2

    def test_the_first_keyframe_promotes_a_constant(self) -> None:
        parameter = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(0, 0.0))
        assert parameter.is_animated
        assert isinstance(parameter, Animatable)

    def test_values_are_held_outside_the_keyframes(self) -> None:
        parameter = Animatable.constant("opacity", 1.0)
        parameter = parameter.with_keyframe(Keyframe.at(10, 0.0))
        parameter = parameter.with_keyframe(Keyframe.at(20, 1.0))
        assert parameter.at(0) == (0.0,)
        assert parameter.at(30) == (1.0,)

    def test_values_are_interpolated_between_keyframes(self) -> None:
        parameter = Animatable.constant("opacity", 1.0)
        parameter = parameter.with_keyframe(Keyframe.at(0, 0.0))
        parameter = parameter.with_keyframe(Keyframe.at(100, 1.0))
        assert parameter.at(50) == (0.5,)

    def test_a_two_component_parameter_interpolates_component_wise(self) -> None:
        parameter = Animatable.constant("position", 0.0, 0.0)
        parameter = parameter.with_keyframe(Keyframe.at(0, 0.0, 10.0))
        parameter = parameter.with_keyframe(Keyframe.at(100, 100.0, 10.0))
        assert parameter.at(50) == (50.0, 10.0)

    def test_keyframes_can_be_added_out_of_order(self) -> None:
        parameter = Animatable.constant("opacity", 1.0)
        parameter = parameter.with_keyframe(Keyframe.at(20, 1.0))
        parameter = parameter.with_keyframe(Keyframe.at(0, 0.0))
        assert parameter.frames == (0, 20)

    def test_one_frame_holds_one_value(self) -> None:
        parameter = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(10, 0.0))
        assert parameter.with_keyframe(Keyframe.at(10, 0.5)).at(10) == (0.5,)

    def test_two_keyframes_on_one_frame_are_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="share frame"):
            Animatable(
                name="opacity",
                value=(1.0,),
                keyframes=(Keyframe.at(10, 0.0), Keyframe.at(10, 0.5)),
            )

    def test_keyframes_come_out_in_frame_order_whatever_the_input(self) -> None:
        parameter = Animatable(
            name="opacity",
            value=(1.0,),
            keyframes=(Keyframe.at(30, 1.0), Keyframe.at(0, 0.0), Keyframe.at(20, 0.5)),
        )
        assert parameter.frames == (0, 20, 30)

    def test_a_keyframe_must_match_the_arity(self) -> None:
        with pytest.raises(NovaInvariantError, match="'position' holds 2"):
            Animatable.constant("position", 0.0, 0.0).with_keyframe(Keyframe.at(0, 1.0))

    def test_a_parameter_must_have_a_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="name"):
            Animatable.constant("", 0.0)

    def test_a_parameter_value_must_be_a_tuple(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a tuple"):
            Animatable(name="opacity", value=[1.0])  # type: ignore[arg-type]

    def test_a_parameter_value_must_be_finite(self) -> None:
        with pytest.raises(NovaInvariantError, match="finite"):
            Animatable.constant("opacity", float("inf"))

    def test_a_scalar_can_be_read_as_a_number(self) -> None:
        assert Animatable.constant("opacity", 0.5).scalar_at(0) == 0.5

    def test_a_vector_cannot_be_read_as_a_number(self) -> None:
        with pytest.raises(NovaInvariantError, match="2 components"):
            Animatable.constant("position", 0.0, 0.0).scalar_at(0)

    def test_a_keyframe_can_be_found_by_frame(self) -> None:
        parameter = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(12, 0.0))
        assert parameter.keyframe_at(12) is not None
        assert parameter.keyframe_at(13) is None

    def test_a_keyframe_can_be_removed(self) -> None:
        parameter = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(12, 0.0))
        assert parameter.without_keyframe(12).is_animated is False

    def test_removing_a_keyframe_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no keyframe at frame 12"):
            Animatable.constant("opacity", 1.0).without_keyframe(12)

    def test_every_value_the_parameter_can_take(self) -> None:
        parameter = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(12, 0.0))
        assert parameter.all_values() == ((1.0,), (0.0,))

    def test_keyframes_move_with_the_clip(self) -> None:
        parameter = Animatable.constant("opacity", 1.0)
        parameter = parameter.with_keyframe(Keyframe.at(10, 0.0)).with_keyframe(
            Keyframe.at(20, 1.0)
        )
        assert parameter.shifted(5).frames == (15, 25)

    def test_keyframes_that_would_fall_before_zero_pile_up_on_it(self) -> None:
        """A ripple edit cannot refuse to move a clip, so the value that would
        have been current at frame zero is the one that survives."""
        parameter = Animatable.constant("opacity", 1.0)
        parameter = parameter.with_keyframe(Keyframe.at(10, 0.0)).with_keyframe(
            Keyframe.at(20, 1.0)
        )
        shifted = parameter.shifted(-30)
        assert shifted.frames == (0,)
        assert shifted.at(0) == (1.0,)

    def test_a_parameter_survives_json(self) -> None:
        parameter = Animatable.constant("position", 0.0, 0.0)
        parameter = parameter.with_keyframe(
            Keyframe.at(0, 1.0, 2.0, interpolation=Interpolation.BEZIER, out_handle=(0.5, 0.5))
        )
        assert Animatable.from_wire(_round_trip(parameter.to_wire())) == parameter

    def test_the_wire_form_carries_the_value_and_the_curve_and_nothing_else(self) -> None:
        """A parameter's kind is declared by the effect spec, not by the value."""
        parameter = Animatable.constant("rotation", 90.0)
        assert sorted(parameter.to_wire()) == ["keyframes", "name", "value"]

    def test_a_wire_parameter_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Animatable.from_wire(dict(Animatable.constant("opacity", 1.0).to_wire(), extra=1))


class TestInterpolate:
    def test_linear_travels_evenly(self) -> None:
        assert interpolate(Keyframe.at(0, 0.0), Keyframe.at(100, 10.0), 50) == (5.0,)

    def test_the_left_keyframe_owns_the_curve(self) -> None:
        """Deleting a keyframe changes the segment before it, not the one after."""
        left = Keyframe.at(0, 0.0, interpolation=Interpolation.EASE_IN)
        assert interpolate(left, Keyframe.at(100, 10.0), 50) == (2.5,)

    def test_hold_jumps_at_the_second_keyframe(self) -> None:
        left = Keyframe.at(0, 0.0, interpolation=Interpolation.HOLD)
        assert interpolate(left, Keyframe.at(100, 10.0), 99) == (0.0,)
        assert interpolate(left, Keyframe.at(100, 10.0), 100) == (10.0,)

    def test_bezier_uses_the_outgoing_and_incoming_handles(self) -> None:
        left = Keyframe.at(0, 0.0, interpolation=Interpolation.BEZIER, out_handle=(0.25, 0.1))
        right = Keyframe.at(100, 10.0, in_handle=(0.25, 1.0))
        assert interpolate(left, right, 50) == pytest.approx((8.024,), abs=1e-3)

    def test_bezier_without_handles_is_linear(self) -> None:
        left = Keyframe.at(0, 0.0, interpolation=Interpolation.BEZIER)
        assert interpolate(left, Keyframe.at(100, 10.0), 50) == (5.0,)

    def test_overshoot_leaves_the_range(self) -> None:
        left = Keyframe.at(0, 0.0, interpolation=Interpolation.BEZIER, out_handle=(0.5, 1.4))
        right = Keyframe.at(100, 10.0, in_handle=(0.5, 1.4))
        assert interpolate(left, right, 50) == pytest.approx((11.75,), abs=1e-2)

    def test_every_component_shares_one_curve(self) -> None:
        left = Keyframe.at(0, 0.0, 100.0)
        assert interpolate(left, Keyframe.at(100, 10.0, 200.0), 50) == (5.0, 150.0)

    def test_the_ends_are_the_keyframe_values(self) -> None:
        left, right = Keyframe.at(0, 0.0), Keyframe.at(100, 10.0)
        assert interpolate(left, right, 0) == (0.0,)
        assert interpolate(left, right, 100) == (10.0,)

    def test_a_reversed_segment_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="frame order"):
            interpolate(Keyframe.at(100, 0.0), Keyframe.at(100, 10.0), 50)
