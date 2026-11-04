"""The effect and animation model (ADR-0006, ADR-0011, ARCHITECTURE §7.2).

What is pinned here is what a user notices when it is wrong:

* **A value at a frame is a fact, not an approximation.**  Keyframes sit on
  integer frames and interpolation is derived from them, so frame 720 has the
  same value in the preview, in the export and in this test suite.
* **The curve a keyframe owns is the one leaving it.**  Deleting a keyframe
  changes the easing of the segment before it, not the one after — the rule
  every editor follows and every from-scratch implementation gets backwards.
* **Constant and animated are one type.**  Adding a keyframe to a constant
  parameter must not change its type, or every reader would need two branches
  for what the user thinks of as one slider.
* **Overshoot is allowed.**  A Bezier handle may leave the 0-1 range in y; a
  bounce that never leaves the range is not a bounce.  It may not leave it in
  x, or the curve stops being a function of time.
* **Order is the effect stack's whole meaning.**  Blur-then-sharpen is not
  sharpen-then-blur, so reordering is an operation with pinned semantics.

Nothing here touches pixels: this is the authoring model, and the renderer is
free to implement it with NumPy, OpenCV or a shader without this file changing.
"""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.domain.animation import Animatable, Interpolation, Keyframe
from nova_studio.domain.effects import (
    DEFAULT_CORNER_RADIUS_PX,
    DEFAULT_FEATHER_PX,
    PARAM_KIND_WIDTHS,
    BlendMode,
    Effect,
    EffectCategory,
    EffectChain,
    EffectCost,
    EffectSpec,
    EffectTarget,
    Mask,
    MaskKind,
    ParameterSpec,
    ParamKind,
    StaticParam,
    Transform,
    validate_chain,
    validate_effect,
    validate_transform,
)

pytestmark = pytest.mark.unit


# -- builders -----------------------------------------------------------------


def _spec(
    type_name: str = "nova.blur",
    *parameters: ParameterSpec,
    **over: Any,
) -> EffectSpec:
    return EffectSpec(**{"type": type_name, "label": "Blur", "parameters": parameters, **over})


def _radius(
    *, minimum: tuple[float, ...] | None = (0.0,), maximum: tuple[float, ...] | None = (100.0,)
) -> ParameterSpec:
    return ParameterSpec(
        name="radius",
        label="Radius",
        kind=ParamKind.SCALAR,
        default=(4.0,),
        minimum=minimum,
        maximum=maximum,
        unit="px",
    )


def _mode() -> ParameterSpec:
    return ParameterSpec(
        name="mode",
        label="Mode",
        kind=ParamKind.CHOICE,
        default="gaussian",
        choices=("gaussian", "box", "motion"),
    )


def _blur_spec() -> EffectSpec:
    return _spec("nova.blur", _radius(), _mode(), category=EffectCategory.BLUR)


def _round_trip(wire: Any) -> Any:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestStaticParam:
    def test_a_static_parameter_ignores_the_frame(self) -> None:
        parameter = StaticParam(name="mode", value="gaussian")
        assert parameter.at(0) == "gaussian"
        assert parameter.at(9999) == "gaussian"

    def test_a_static_parameter_may_be_a_number(self) -> None:
        assert StaticParam(name="seed", value=7).at(0) == 7

    def test_a_static_parameter_may_be_a_switch(self) -> None:
        assert StaticParam(name="invert", value=False).at(0) is False

    def test_a_parameter_must_have_a_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="name"):
            StaticParam(name="", value="gaussian")

    def test_a_number_must_be_finite(self) -> None:
        with pytest.raises(NovaInvariantError, match="finite"):
            StaticParam(name="seed", value=float("inf"))

    def test_a_static_parameter_survives_json(self) -> None:
        for value in ("gaussian", 7, 0.5, True):
            parameter = StaticParam(name="p", value=value)
            assert StaticParam.from_wire(_round_trip(parameter.to_wire())) == parameter

    def test_a_wire_value_must_be_scalar(self) -> None:
        with pytest.raises(NovaInvariantError, match="string, number or bool"):
            StaticParam.from_wire({"name": "p", "value": [1, 2]})

    def test_a_wire_parameter_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            StaticParam.from_wire(dict(StaticParam(name="p", value=1).to_wire(), extra=1))


class TestParamKind:
    def test_the_arity_of_every_kind(self) -> None:
        assert PARAM_KIND_WIDTHS[ParamKind.SCALAR] == 1
        assert PARAM_KIND_WIDTHS[ParamKind.VECTOR2] == 2
        assert PARAM_KIND_WIDTHS[ParamKind.VECTOR3] == 3
        assert PARAM_KIND_WIDTHS[ParamKind.VECTOR4] == 4
        assert PARAM_KIND_WIDTHS[ParamKind.ANGLE] == 1
        assert PARAM_KIND_WIDTHS[ParamKind.PERCENT] == 1
        assert PARAM_KIND_WIDTHS[ParamKind.INTEGER] == 1
        assert PARAM_KIND_WIDTHS[ParamKind.COLOUR] == 3

    def test_the_width_property_agrees_with_the_table(self) -> None:
        for kind, width in PARAM_KIND_WIDTHS.items():
            assert kind.width == width

    def test_only_numbers_can_be_animated(self) -> None:
        assert ParamKind.SCALAR.is_numeric
        assert ParamKind.COLOUR.is_numeric
        assert not ParamKind.CHOICE.is_numeric
        assert not ParamKind.BOOL.is_numeric
        assert not ParamKind.TEXT.is_numeric
        assert not ParamKind.FILE.is_numeric

    def test_the_kinds_that_are_not_numbers_have_no_width(self) -> None:
        assert ParamKind.TEXT.width == 0


class TestParameterSpec:
    def test_a_spec_describes_one_parameter(self) -> None:
        spec = _radius()
        assert (spec.name, spec.label, spec.width, spec.unit) == ("radius", "Radius", 1, "px")

    def test_the_default_is_the_value_a_fresh_effect_gets(self) -> None:
        assert _radius().numeric_default == (4.0,)

    def test_a_numeric_default_must_be_a_tuple(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a tuple"):
            ParameterSpec(name="radius", label="Radius", default=4.0)

    def test_the_default_must_match_the_arity(self) -> None:
        with pytest.raises(NovaInvariantError, match="must hold 2 components"):
            ParameterSpec(name="position", label="Position", kind=ParamKind.VECTOR2, default=(0.0,))

    def test_the_default_must_be_inside_the_range(self) -> None:
        with pytest.raises(NovaInvariantError, match="outside"):
            ParameterSpec(name="radius", label="Radius", default=(-1.0,), minimum=(0.0,))

    def test_the_default_must_be_finite(self) -> None:
        with pytest.raises(NovaInvariantError, match="finite"):
            ParameterSpec(name="radius", label="Radius", default=(float("nan"),))

    def test_a_bound_must_match_the_arity(self) -> None:
        with pytest.raises(NovaInvariantError, match="minimum must hold 2"):
            ParameterSpec(
                name="position",
                label="Position",
                kind=ParamKind.VECTOR2,
                default=(0.0, 0.0),
                minimum=(0.0,),
            )

    def test_a_step_must_be_positive(self) -> None:
        with pytest.raises(NovaInvariantError, match="step"):
            ParameterSpec(name="radius", label="Radius", step=0.0)

    def test_a_choice_must_offer_choices(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least one choice"):
            ParameterSpec(name="mode", label="Mode", kind=ParamKind.CHOICE, default="gaussian")

    def test_a_choice_default_must_be_one_of_them(self) -> None:
        with pytest.raises(NovaInvariantError, match="not one of"):
            ParameterSpec(
                name="mode",
                label="Mode",
                kind=ParamKind.CHOICE,
                default="median",
                choices=("gaussian",),
            )

    def test_a_switch_defaults_to_a_bool(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a bool"):
            ParameterSpec(name="invert", label="Invert", kind=ParamKind.BOOL, default="yes")

    def test_a_text_default_is_a_string(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a str"):
            ParameterSpec(name="label", label="Label", kind=ParamKind.TEXT, default=(0.0,))

    def test_a_spec_must_be_named(self) -> None:
        with pytest.raises(NovaInvariantError, match="name"):
            ParameterSpec(name="", label="Radius")
        with pytest.raises(NovaInvariantError, match="label"):
            ParameterSpec(name="radius", label="")

    def test_numbers_cannot_be_read_as_a_static_default(self) -> None:
        with pytest.raises(NovaInvariantError, match="its default is numbers"):
            _ = _radius().static_default

    def test_a_choice_cannot_be_read_as_numbers(self) -> None:
        with pytest.raises(NovaInvariantError, match="not numbers"):
            _ = _mode().numeric_default

    def test_a_spec_survives_json(self) -> None:
        spec = ParameterSpec(
            name="position",
            label="Position",
            kind=ParamKind.VECTOR2,
            default=(0.0, 0.0),
            minimum=(-1.0, -1.0),
            maximum=(1.0, 1.0),
            step=0.01,
            unit="px",
            hint="Where it sits",
            animatable=True,
        )
        assert ParameterSpec.from_wire(_round_trip(spec.to_wire())) == spec

    def test_a_wire_spec_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            ParameterSpec.from_wire(dict(_radius().to_wire(), extra=1))


class TestEffectSpec:
    def test_a_spec_describes_an_effect(self) -> None:
        spec = _blur_spec()
        assert (spec.type, spec.label, spec.category) == (
            "nova.blur",
            "Blur",
            EffectCategory.BLUR,
        )

    def test_parameters_are_listed_in_order(self) -> None:
        assert _blur_spec().parameter_names == ("radius", "mode")

    def test_a_parameter_can_be_looked_up(self) -> None:
        assert _blur_spec().parameter("radius") is not None
        assert _blur_spec().parameter("nope") is None

    def test_two_parameters_may_not_share_a_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="share the name"):
            _spec("nova.blur", _radius(), _radius())

    def test_a_spec_must_be_named(self) -> None:
        with pytest.raises(NovaInvariantError, match="type"):
            _spec("")
        with pytest.raises(NovaInvariantError, match="label"):
            EffectSpec(type="nova.blur", label="")

    def test_a_version_starts_at_one(self) -> None:
        with pytest.raises(NovaInvariantError, match="version"):
            _spec("nova.blur", version=0)

    def test_an_effect_must_be_attachable_to_something(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least one target"):
            _spec("nova.blur", targets=frozenset())

    def test_targets_are_declared_not_assumed(self) -> None:
        spec = _blur_spec()
        assert spec.supports(EffectTarget.CLIP)
        assert not spec.supports(EffectTarget.OUTPUT)

    def test_a_fresh_effect_gets_the_default_parameters(self) -> None:
        params = _blur_spec().default_params()
        assert [(param.name, param.at(0)) for param in params] == [
            ("radius", (4.0,)),
            ("mode", "gaussian"),
        ]

    def test_a_parameter_that_cannot_be_animated_stays_static(self) -> None:
        spec = _spec(
            "nova.blur",
            ParameterSpec(
                name="invert", label="Invert", kind=ParamKind.BOOL, default=False, animatable=False
            ),
        )
        param = spec.default_params()[0]
        assert isinstance(param, StaticParam)

    def test_a_spec_survives_json(self) -> None:
        spec = _spec(
            "nova.blur",
            _radius(),
            _mode(),
            version=2,
            targets=frozenset({EffectTarget.CLIP, EffectTarget.TRACK}),
            cost=EffectCost.EXPENSIVE,
            supports_gpu=True,
            is_transition=True,
        )
        assert EffectSpec.from_wire(_round_trip(spec.to_wire())) == spec

    def test_a_wire_spec_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            EffectSpec.from_wire(dict(_blur_spec().to_wire(), extra=1))


class TestEffect:
    def test_an_effect_is_a_type_and_its_parameters(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        assert effect.type == "nova.blur"
        assert effect.effect_id == "e1"

    def test_a_fresh_effect_is_on_and_fully_mixed(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        assert not effect.is_bypassed

    def test_a_disabled_effect_does_nothing_but_stays_put(self) -> None:
        assert Effect.for_spec("e1", _blur_spec()).with_enabled(False).is_bypassed

    def test_a_zero_mix_is_a_bypass(self) -> None:
        assert Effect.for_spec("e1", _blur_spec()).with_mix(0.0).is_bypassed

    def test_an_effect_must_have_an_id_and_a_type(self) -> None:
        with pytest.raises(NovaInvariantError, match="effect_id"):
            Effect(effect_id="", type="nova.blur")
        with pytest.raises(NovaInvariantError, match="type"):
            Effect(effect_id="e1", type="")

    def test_the_mix_is_a_fraction(self) -> None:
        with pytest.raises(NovaInvariantError, match="mix"):
            Effect(effect_id="e1", type="nova.blur", mix=1.5)

    def test_two_parameters_may_not_share_a_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="share the name"):
            Effect(
                effect_id="e1",
                type="nova.blur",
                params=(StaticParam(name="a", value=1), StaticParam(name="a", value=2)),
            )

    def test_a_parameter_validates_its_own_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="name must not be empty"):
            StaticParam(name="", value=1)

    def test_a_parameter_can_be_read_by_name(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        assert effect.param("radius") is not None
        assert effect.param("nope") is None

    def test_an_animated_parameter_can_be_read_as_one(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        assert effect.animatable("radius") is not None
        assert effect.animatable("mode") is None

    def test_a_parameter_can_be_read_at_a_frame(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        assert effect.param_at("radius", 0) == (4.0,)
        assert effect.param_at("mode", 0) == "gaussian"
        assert effect.param_at("nope", 0) is None

    def test_setting_a_parameter_replaces_one_of_that_name(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec())
        bumped = effect.with_param(Animatable.constant("radius", 20.0))
        assert len(bumped.params) == 2
        assert bumped.param_at("radius", 0) == (20.0,)

    def test_removing_a_parameter_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no parameter named"):
            Effect.for_spec("e1", _blur_spec()).without_param("nope")

    def test_an_effect_survives_json(self) -> None:
        effect = Effect.for_spec("e1", _blur_spec(), name="soft focus")
        effect = effect.with_param(
            Animatable.constant("radius", 4.0).with_keyframe(Keyframe.at(0, 0.0))
        ).with_mix(0.5)
        assert Effect.from_wire(_round_trip(effect.to_wire())) == effect

    def test_the_two_parameter_kinds_are_tagged_on_the_wire(self) -> None:
        """A reader must not have to inspect a payload's shape to know."""
        wire = Effect.for_spec("e1", _blur_spec()).to_wire()["params"]
        assert [entry["kind"] for entry in wire] == ["animatable", "static"]

    def test_a_wire_effect_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Effect.from_wire(dict(Effect.for_spec("e1", _blur_spec()).to_wire(), extra=1))

    def test_a_wire_effect_rejects_an_unknown_parameter_kind(self) -> None:
        wire = Effect.for_spec("e1", _blur_spec()).to_wire()
        wire["params"][0]["kind"] = "mystery"
        with pytest.raises(NovaInvariantError, match="animatable' or 'static"):
            Effect.from_wire(wire)


class TestEffectChain:
    def test_a_new_chain_is_empty(self) -> None:
        chain = EffectChain()
        assert chain.is_empty
        assert chain.count == 0

    def test_effects_are_applied_in_order(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("first", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("second", _blur_spec()))
        assert [effect.effect_id for effect in chain.effects] == ["first", "second"]

    def test_only_working_effects_are_active(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("on", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("off", _blur_spec()).with_enabled(False))
        assert [effect.effect_id for effect in chain.active] == ["on"]
        assert chain.count == 2

    def test_an_effect_can_be_found_by_id(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("e1", _blur_spec()))
        assert chain.effect("e1") is not None
        assert chain.effect("nope") is None
        assert chain.index_of("e1") == 0

    def test_two_effects_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="already in this chain"):
            EffectChain().with_effect(Effect.for_spec("e1", _blur_spec())).with_effect(
                Effect.for_spec("e1", _blur_spec())
            )

    def test_removing_an_effect_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no effect with id"):
            EffectChain().without_effect("e1")

    def test_replacing_an_effect_keeps_its_place(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("e1", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("e2", _blur_spec()))
        replaced = chain.replaced(Effect.for_spec("e1", _blur_spec()).with_mix(0.25))
        assert [effect.effect_id for effect in replaced.effects] == ["e1", "e2"]
        assert replaced.effect("e1") is not None
        assert replaced.effect("e1").mix == 0.25

    def test_replacing_an_effect_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no effect with id"):
            EffectChain().replaced(Effect.for_spec("e1", _blur_spec()))

    def test_an_effect_can_be_moved_up_the_stack(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("e1", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("e2", _blur_spec()))
        assert [effect.effect_id for effect in chain.moved("e1", 1).effects] == ["e2", "e1"]

    def test_moving_past_the_end_leaves_it_there(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("e1", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("e2", _blur_spec()))
        assert [effect.effect_id for effect in chain.moved("e2", -99).effects] == ["e2", "e1"]
        assert [effect.effect_id for effect in chain.moved("e1", 99).effects] == ["e2", "e1"]

    def test_moving_an_effect_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no effect with id"):
            EffectChain().moved("e1", 1)

    def test_shifting_moves_every_animated_parameter(self) -> None:
        effect = Effect(
            effect_id="e1",
            type="nova.blur",
            params=(
                Animatable.constant("radius", 4.0).with_keyframe(Keyframe.at(10, 0.0)),
                StaticParam(name="mode", value="gaussian"),
            ),
        )
        shifted = EffectChain().with_effect(effect).shifted(5)
        assert shifted.effect("e1") is not None
        radius = shifted.effect("e1").animatable("radius")
        assert radius is not None
        assert radius.frames == (15,)
        assert shifted.effect("e1").param_at("mode", 0) == "gaussian"

    def test_a_chain_survives_json(self) -> None:
        chain = EffectChain().with_effect(Effect.for_spec("e1", _blur_spec()))
        chain = chain.with_effect(Effect.for_spec("e2", _blur_spec()).with_mix(0.5))
        assert EffectChain.from_wire(_round_trip(chain.to_wire())) == chain

    def test_a_wire_chain_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            EffectChain.from_wire(dict(EffectChain().to_wire(), extra=1))


class TestValidateEffect:
    def test_a_fresh_effect_is_valid(self) -> None:
        spec = _blur_spec()
        assert validate_effect(Effect.for_spec("e1", spec), spec) == ""

    def test_an_effect_is_checked_against_its_own_type(self) -> None:
        spec = _blur_spec()
        other = _spec("nova.sharpen", _radius())
        assert "is being checked against" in validate_effect(Effect.for_spec("e1", spec), other)

    def test_a_parameter_the_effect_does_not_declare_is_reported(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).with_param(Animatable.constant("gamma", 1.0))
        assert "'gamma' that 'nova.blur' does not declare" in validate_effect(effect, spec)

    def test_a_missing_parameter_is_reported(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).without_param("mode")
        assert "parameter 'mode'" in validate_effect(effect, spec)
        assert "is missing" in validate_effect(effect, spec)

    def test_a_value_above_the_maximum_is_reported(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).with_param(Animatable.constant("radius", 500.0))
        assert "above the maximum 100.0" in validate_effect(effect, spec)

    def test_a_keyframe_out_of_range_is_reported(self) -> None:
        spec = _blur_spec()
        radius = Animatable.constant("radius", 4.0).with_keyframe(Keyframe.at(12, -5.0))
        effect = Effect.for_spec("e1", spec).with_param(radius)
        assert "below the minimum 0.0" in validate_effect(effect, spec)

    def test_a_value_that_is_not_a_declared_choice_is_reported(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).with_param(StaticParam(name="mode", value="median"))
        assert "must be one of ['gaussian', 'box', 'motion']" in validate_effect(effect, spec)

    def test_a_switch_must_be_a_bool(self) -> None:
        spec = _spec(
            "nova.invert", ParameterSpec(name="on", label="On", kind=ParamKind.BOOL, default=True)
        )
        effect = Effect.for_spec("e1", spec).with_param(StaticParam(name="on", value="yes"))
        assert "must be a bool" in validate_effect(effect, spec)

    def test_a_text_parameter_must_be_a_string(self) -> None:
        spec = _spec(
            "nova.text",
            ParameterSpec(name="content", label="Content", kind=ParamKind.TEXT, default=""),
        )
        effect = Effect.for_spec("e1", spec).with_param(StaticParam(name="content", value=7))
        assert "must be a string" in validate_effect(effect, spec)

    def test_numbers_may_not_be_supplied_as_a_static_value(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).with_param(StaticParam(name="radius", value=4))
        assert "must be animatable numbers" in validate_effect(effect, spec)

    def test_a_choice_may_not_carry_keyframes(self) -> None:
        spec = _blur_spec()
        effect = Effect.for_spec("e1", spec).with_param(Animatable.constant("mode", 0.0))
        assert "carries keyframes" in validate_effect(effect, spec)

    def test_the_wrong_arity_is_reported(self) -> None:
        spec = _spec(
            "nova.blur",
            ParameterSpec(
                name="amount", label="Amount", kind=ParamKind.VECTOR2, default=(1.0, 1.0)
            ),
        )
        effect = Effect.for_spec("e1", spec).with_param(Animatable.constant("amount", 1.0))
        assert "must hold 2 components, got 1" in validate_effect(effect, spec)

    def test_a_parameter_that_cannot_be_animated_may_not_be(self) -> None:
        spec = _spec(
            "nova.blur",
            ParameterSpec(name="radius", label="Radius", default=(4.0,), animatable=False),
        )
        effect = Effect.for_spec("e1", spec)
        animated = effect.with_param(
            Animatable.constant("radius", 4.0).with_keyframe(Keyframe.at(0, 1.0))
        )
        assert "is declared not animatable" in validate_effect(animated, spec)


class TestValidateChain:
    def test_a_chain_of_valid_effects_is_valid(self) -> None:
        spec = _blur_spec()
        chain = EffectChain().with_effect(Effect.for_spec("e1", spec))
        assert validate_chain(chain, {spec.type: spec}) == ""

    def test_the_first_broken_effect_is_reported(self) -> None:
        spec = _blur_spec()
        broken = Effect.for_spec("e2", spec).with_param(Animatable.constant("radius", 500.0))
        chain = EffectChain().with_effect(Effect.for_spec("e1", spec)).with_effect(broken)
        assert "above the maximum" in validate_chain(chain, {spec.type: spec})

    def test_an_effect_with_no_installed_spec_is_left_alone(self) -> None:
        """A project with an uninstalled plugin must still open."""
        chain = EffectChain().with_effect(Effect(effect_id="e1", type="com.vendor.unknown"))
        assert validate_chain(chain, {}) == ""


class TestTransform:
    def test_a_fresh_transform_is_a_no_op(self) -> None:
        transform = Transform()
        assert transform.at(0).is_identity
        assert transform.at(0).position == (0.0, 0.0)
        assert transform.at(0).scale == (1.0, 1.0)

    def test_the_geometry_is_read_at_a_frame(self) -> None:
        transform = replace(
            Transform(),
            position=Animatable.constant("position", 10.0, -20.0),
        )
        assert transform.at(12).position == (10.0, -20.0)

    def test_a_transform_can_be_animated(self) -> None:
        position = Animatable.constant("position", 0.0, 0.0)
        position = position.with_keyframe(Keyframe.at(0, 0.0, 0.0))
        position = position.with_keyframe(Keyframe.at(100, 100.0, 0.0))
        transform = replace(Transform(), position=position)
        assert not transform.is_static
        assert transform.at(50).position == (50.0, 0.0)

    def test_one_keyframe_still_pins_a_constant(self) -> None:
        opacity = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(0, 1.0))
        assert replace(Transform(), opacity=opacity).is_static

    def test_crop_removes_source_pixels_before_scaling(self) -> None:
        transform = replace(
            Transform(),
            crop=Animatable.constant("crop", 0.1, 0.0, 0.1, 0.0),
        )
        assert transform.at(0).source_size(1920, 1080) == (1536.0, 1080.0)

    def test_the_rendered_size_is_the_cropped_source_times_the_scale(self) -> None:
        transform = replace(
            Transform(),
            scale=Animatable.constant("scale", 0.5, 0.5),
            crop=Animatable.constant("crop", 0.1, 0.0, 0.1, 0.0),
        )
        assert transform.at(0).rendered_size(1920, 1080) == (768.0, 540.0)

    def test_a_faded_out_layer_has_nothing_to_draw(self) -> None:
        transform = replace(Transform(), opacity=Animatable.constant("opacity", 0.0))
        assert not transform.at(0).is_visible(1920, 1080)

    def test_a_layer_scaled_to_nothing_has_nothing_to_draw(self) -> None:
        transform = replace(Transform(), scale=Animatable.constant("scale", 0.0, 1.0))
        assert not transform.at(0).is_visible(1920, 1080)

    def test_a_fully_cropped_layer_has_nothing_to_draw(self) -> None:
        transform = replace(
            Transform(),
            crop=Animatable.constant("crop", 0.5, 0.0, 0.5, 0.0),
        )
        assert not transform.at(0).is_visible(1920, 1080)

    def test_a_full_opacity_layer_hides_what_is_below_it(self) -> None:
        assert Transform().at(0).is_opaque

    def test_flips_are_part_of_the_geometry(self) -> None:
        transform = replace(Transform(), flip_x=True, flip_y=True)
        assert transform.at(0).flip_x
        assert transform.at(0).flip_y

    def test_each_part_must_have_its_own_arity(self) -> None:
        with pytest.raises(NovaInvariantError, match="'position' must hold 2"):
            replace(Transform(), position=Animatable.constant("position", 0.0))

    def test_keyframes_move_with_the_clip(self) -> None:
        position = Animatable.constant("position", 0.0, 0.0)
        position = position.with_keyframe(Keyframe.at(10, 0.0, 0.0))
        shifted = replace(Transform(), position=position).shifted(5)
        assert shifted.position.frames == (15,)

    def test_a_transform_survives_json(self) -> None:
        transform = replace(
            Transform(),
            position=Animatable.constant("position", 10.0, 20.0).with_keyframe(
                Keyframe.at(0, 0.0, 0.0, interpolation=Interpolation.EASE_OUT)
            ),
            rotation=Animatable.constant("rotation", 90.0),
            flip_x=True,
        )
        assert Transform.from_wire(_round_trip(transform.to_wire())) == transform

    def test_a_wire_transform_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Transform.from_wire(dict(Transform().to_wire(), extra=1))


class TestValidateTransform:
    def test_a_fresh_transform_is_valid(self) -> None:
        assert validate_transform(Transform()) == ""

    def test_opacity_is_a_fraction(self) -> None:
        transform = replace(Transform(), opacity=Animatable.constant("opacity", 1.4))
        assert "opacity must be between 0 and 1" in validate_transform(transform)

    def test_a_keyframed_opacity_is_checked_too(self) -> None:
        opacity = Animatable.constant("opacity", 1.0).with_keyframe(Keyframe.at(12, 2.0))
        assert "opacity must be between 0 and 1" in validate_transform(
            replace(Transform(), opacity=opacity)
        )

    def test_a_crop_edge_is_a_fraction(self) -> None:
        crop = Animatable.constant("crop", -0.1, 0.0, 0.0, 0.0)
        assert "crop left must be between 0 and 1" in validate_transform(
            replace(Transform(), crop=crop)
        )

    def test_crop_may_not_remove_everything(self) -> None:
        crop = Animatable.constant("crop", 0.6, 0.0, 0.6, 0.0)
        assert "left+right must leave something" in validate_transform(
            replace(Transform(), crop=crop)
        )

    def test_crop_may_not_remove_every_row(self) -> None:
        crop = Animatable.constant("crop", 0.0, 0.6, 0.0, 0.6)
        assert "top+bottom must leave something" in validate_transform(
            replace(Transform(), crop=crop)
        )


class TestMask:
    def test_a_fresh_mask_covers_the_whole_layer(self) -> None:
        mask = Mask(mask_id="m1")
        assert mask.kind is MaskKind.RECTANGLE
        assert mask.is_full_frame
        assert mask.at(0).bounds == (0.5, 0.5, 1.0, 1.0)

    def test_the_defaults_are_hard_and_square(self) -> None:
        sample = Mask(mask_id="m1").at(0)
        assert sample.feather == DEFAULT_FEATHER_PX
        assert sample.corner_radius == DEFAULT_CORNER_RADIUS_PX

    def test_bounds_only_mean_something_for_a_shape(self) -> None:
        assert MaskKind.RECTANGLE.uses_bounds
        assert MaskKind.ELLIPSE.uses_bounds
        assert not MaskKind.PATH.uses_bounds
        assert not MaskKind.ALPHA.uses_bounds
        assert not MaskKind.LUMINANCE.uses_bounds

    def test_a_mask_may_take_its_shape_from_the_layer(self) -> None:
        assert Mask(mask_id="m1", kind=MaskKind.ALPHA).at(0).bounds == (0.5, 0.5, 1.0, 1.0)

    def test_a_path_needs_at_least_a_triangle(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least three points"):
            Mask(mask_id="m1", kind=MaskKind.PATH, points=((0.0, 0.0), (1.0, 1.0)))

    def test_only_a_path_takes_points(self) -> None:
        with pytest.raises(NovaInvariantError, match="not from points"):
            Mask(mask_id="m1", kind=MaskKind.ELLIPSE, points=((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)))

    def test_a_path_point_is_a_pair(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a pair"):
            Mask(mask_id="m1", kind=MaskKind.PATH, points=((0.0,), (1.0, 0.0), (0.0, 1.0)))

    def test_a_mask_must_have_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="mask_id"):
            Mask(mask_id="")

    def test_a_faded_out_mask_does_nothing(self) -> None:
        mask = replace(Mask(mask_id="m1"), opacity=Animatable.constant("opacity", 0.0))
        assert not mask.at(0).is_effective

    def test_a_mask_can_be_inverted(self) -> None:
        assert replace(Mask(mask_id="m1"), invert=True).at(0).invert

    def test_each_part_must_have_its_own_arity(self) -> None:
        with pytest.raises(NovaInvariantError, match="'bounds' must hold 4"):
            replace(Mask(mask_id="m1"), bounds=Animatable.constant("bounds", 0.5))

    def test_keyframes_move_with_the_clip(self) -> None:
        bounds = Animatable.constant("bounds", 0.5, 0.5, 1.0, 1.0).with_keyframe(
            Keyframe.at(10, 0.0, 0.0, 0.5, 0.5)
        )
        assert replace(Mask(mask_id="m1"), bounds=bounds).shifted(5).bounds.frames == (15,)

    def test_a_mask_survives_json(self) -> None:
        mask = Mask(
            mask_id="m1",
            kind=MaskKind.PATH,
            points=((-1.0, -1.0), (1.0, -1.0), (0.0, 1.0)),
            feather=Animatable.constant("feather", 12.0),
            invert=True,
            name="keyhole",
        )
        assert Mask.from_wire(_round_trip(mask.to_wire())) == mask

    def test_a_wire_mask_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Mask.from_wire(dict(Mask(mask_id="m1").to_wire(), extra=1))


class TestBlendMode:
    def test_most_modes_are_computed_one_channel_at_a_time(self) -> None:
        assert BlendMode.MULTIPLY.is_separable
        assert BlendMode.SCREEN.is_separable
        assert BlendMode.OVERLAY.is_separable

    def test_the_hue_family_needs_the_whole_colour(self) -> None:
        assert not BlendMode.HUE.is_separable
        assert not BlendMode.SATURATION.is_separable
        assert not BlendMode.COLOR.is_separable
        assert not BlendMode.LUMINOSITY.is_separable

    def test_additive_and_subtractive_are_available(self) -> None:
        assert BlendMode.ADD.is_separable
        assert BlendMode.SUBTRACT.is_separable
