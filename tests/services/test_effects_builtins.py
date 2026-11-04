"""The built-in effect catalogue (`services/effects/builtins.py`).

The catalogue is data, and data drifts: a range that no longer matches the
kernel that consumes it, a default that is outside its own bounds, a GPU hint
that was never revisited.  These tests are the cheap guard — every built-in
must be constructible, instantiate, and validate against itself.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.effects import EffectCategory, EffectCost, EffectTarget
from nova_studio.services.effects import (
    BUILTIN_TYPES,
    builtin_registry,
    builtin_specs,
)

pytestmark = pytest.mark.unit


class TestCatalogue:
    def test_there_are_builtin_effects(self) -> None:
        assert len(builtin_specs()) > 0

    def test_every_type_names_a_namespace(self) -> None:
        """Built-ins live under `nova.`, so a plugin cannot collide with one by
        accident."""
        assert all(spec.type.startswith("nova.") for spec in builtin_specs())

    def test_no_two_builtins_share_a_type(self) -> None:
        types = [spec.type for spec in builtin_specs()]
        assert len(types) == len(set(types))

    def test_every_builtin_has_a_label(self) -> None:
        assert all(spec.label for spec in builtin_specs())

    def test_every_builtin_is_categorised(self) -> None:
        """An uncategorised effect is invisible in the browser."""
        assert all(spec.category is not EffectCategory.CUSTOM for spec in builtin_specs())

    def test_every_builtin_supports_a_target(self) -> None:
        assert all(spec.targets for spec in builtin_specs())

    def test_every_builtin_instantiates(self) -> None:
        registry = builtin_registry()
        for effect_type in BUILTIN_TYPES:
            assert registry.instantiate(effect_type, "e1").is_ok() is True

    def test_every_builtin_validates_against_itself(self) -> None:
        """A catalogue entry whose own default parameters it rejects is the
        cheapest bug to catch and the most embarrassing to ship."""
        registry = builtin_registry()
        for effect_type in sorted(BUILTIN_TYPES):
            effect = registry.instantiate(effect_type, "e1").unwrap()
            assert registry.validate(effect).is_ok() is True, effect_type

    def test_every_builtin_default_sits_inside_its_own_bounds(self) -> None:
        for spec in builtin_specs():
            for parameter in spec.parameters:
                if not parameter.kind.is_numeric:
                    continue
                for value, low, high in zip(
                    parameter.numeric_default,
                    parameter.minimum or (value * 0 for value in parameter.numeric_default),
                    parameter.maximum
                    or (value * 0 + float("inf") for value in parameter.numeric_default),
                    strict=True,
                ):
                    assert low <= value <= high, f"{spec.type}.{parameter.name}"

    def test_the_types_are_stable(self) -> None:
        """A project saved against these names must keep opening."""
        assert "nova.blur" in BUILTIN_TYPES
        assert "nova.saturation" in BUILTIN_TYPES

    def test_the_registry_holds_every_builtin(self) -> None:
        assert builtin_registry().types == tuple(sorted(BUILTIN_TYPES))

    def test_a_builtin_spec_cannot_be_altered(self) -> None:
        """The catalogue is shared rather than copied, so it has to be
        immutable."""
        with pytest.raises(AttributeError):
            builtin_specs()[0].label = "Changed"

    def test_the_catalogue_is_not_mutated_by_registering_it(self) -> None:
        before = builtin_registry().types
        builtin_registry().register(builtin_specs()[0])
        assert builtin_registry().types == before


class TestCostsAndTargets:
    def test_colour_effects_may_go_on_the_output(self) -> None:
        """An output grade is a colour operation; the browser must offer it."""
        for effect_type in ("nova.saturation", "nova.vignette", "nova.invert"):
            spec = builtin_registry().spec_for(effect_type)
            assert spec is not None and spec.supports(EffectTarget.OUTPUT)

    def test_a_blur_does_not_go_on_the_output(self) -> None:
        """Blurring the finished composite is almost never what was meant."""
        spec = builtin_registry().spec_for("nova.blur")
        assert spec is not None and not spec.supports(EffectTarget.OUTPUT)

    def test_expensive_effects_are_marked_so_preview_can_drop_them(self) -> None:
        """A cost hint is what lets preview hold frame rate (ADR-0012)."""
        expensive = [spec.type for spec in builtin_specs() if spec.cost is EffectCost.EXPENSIVE]
        assert expensive

    def test_the_generator_needs_no_input_frame(self) -> None:
        spec = builtin_registry().spec_for("nova.solid")
        assert spec is not None and spec.is_generator is True

    def test_no_builtin_is_quietly_a_transition(self) -> None:
        assert all(not spec.is_transition for spec in builtin_specs())

    def test_no_builtin_is_quietly_an_audio_effect(self) -> None:
        assert all(not spec.is_audio for spec in builtin_specs())

    def test_a_choice_parameter_offers_choices(self) -> None:
        from nova_studio.domain.effects import ParamKind

        for spec in builtin_specs():
            for parameter in spec.parameters:
                if parameter.kind is ParamKind.CHOICE:
                    assert parameter.choices

    def test_parameters_with_a_unit_are_numeric(self) -> None:
        """A unit on a switch is a copy-paste mistake in the catalogue."""
        for spec in builtin_specs():
            for parameter in spec.parameters:
                if parameter.unit:
                    assert parameter.kind.is_numeric

    def test_names_do_not_collide_within_a_spec(self) -> None:
        for spec in builtin_specs():
            names = [parameter.name for parameter in spec.parameters]
            assert len(names) == len(set(names))


class TestBuiltinRegistry:
    def test_the_registry_can_be_extended_by_a_plugin(self) -> None:
        from nova_studio.domain.effects import EffectSpec

        plugin = EffectSpec(type="thirdparty.lens-blur", label="Lens Blur")
        registry = builtin_registry().register(plugin).unwrap()
        assert "thirdparty.lens-blur" in registry

    def test_a_plugin_may_not_claim_a_builtin_name(self) -> None:
        from nova_studio.domain.effects import EffectSpec

        impostor = EffectSpec(type="nova.blur", label="Not Blur")
        assert builtin_registry().register(impostor).is_err() is True

    def test_an_unknown_type_cannot_be_instantiated(self) -> None:
        assert builtin_registry().instantiate("thirdparty.absent", "e1").is_err() is True

    def test_a_builtin_chain_validates(self) -> None:
        from nova_studio.domain.effects import EffectChain

        registry = builtin_registry()
        chain = EffectChain(
            effects=(
                registry.instantiate("nova.blur", "e1").unwrap(),
                registry.instantiate("nova.saturation", "e2").unwrap(),
            )
        )
        assert registry.validate_chain(chain).is_ok() is True
