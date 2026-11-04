"""The effect registry (`services/effects/registry.py`).

What is pinned here is the behaviour a plugin system lives or dies by:

* **Registering is not mutating.**  A plugin that fails half way through
  installing must leave the running registry exactly as it was, so a registry is
  a value and `register` returns a new one.
* **A name collision is refused, not resolved.**  A plugin that silently
  replaced a built-in would change the look of every project using that effect,
  which is the worst possible way to find out about a clash.
* **An uninstalled effect is a state, not an error.**  A project that names an
  effect whose plugin is missing still opens and is validated as `Ok`.  Refusing
  would make an optional plugin mandatory (ADR-0015 rule 3).
* **Errors carry codes, not prose.**  The UI localises by `NS-EFFECT-4xxx`, so
  the codes are asserted on rather than the sentences.
"""

from __future__ import annotations

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.domain.animation import Animatable, Keyframe
from nova_studio.domain.effects import (
    Effect,
    EffectCategory,
    EffectChain,
    EffectSpec,
    EffectTarget,
    ParameterSpec,
    ParamKind,
    StaticParam,
)
from nova_studio.services.effects import (
    NS_EFFECT_DUPLICATE_TYPE,
    NS_EFFECT_SPEC_MISMATCH,
    NS_EFFECT_UNKNOWN_TYPE,
    EffectRegistry,
)

pytestmark = pytest.mark.unit


# -- builders -----------------------------------------------------------------


def _radius(name: str = "radius") -> ParameterSpec:
    return ParameterSpec(
        name=name,
        label="Radius",
        kind=ParamKind.SCALAR,
        default=(4.0,),
        minimum=(0.0,),
        maximum=(100.0,),
        unit="px",
    )


def _spec(
    type_name: str = "nova.test",
    *parameters: ParameterSpec,
    **over: object,
) -> EffectSpec:
    defaults: dict[str, object] = {
        "type": type_name,
        "label": "Test",
        "parameters": parameters or (_radius(),),
    }
    return EffectSpec(**{**defaults, **over})  # type: ignore[arg-type]


def _registry(*specs: EffectSpec) -> EffectRegistry:
    return EffectRegistry(specs=specs)


def _effect(
    effect_id: str = "e1",
    type_name: str = "nova.test",
    **over: object,
) -> Effect:
    defaults: dict[str, object] = {"effect_id": effect_id, "type": type_name}
    return Effect(**{**defaults, **over})  # type: ignore[arg-type]


class TestReading:
    def test_an_empty_registry_holds_nothing(self) -> None:
        assert len(EffectRegistry()) == 0

    def test_a_registry_holds_what_it_was_given(self) -> None:
        assert len(_registry(_spec("a"), _spec("b"))) == 2

    def test_types_are_sorted(self) -> None:
        """The effect browser must not reshuffle itself between runs."""
        registry = _registry(_spec("nova.zoom"), _spec("nova.blur"))
        assert registry.types == ("nova.blur", "nova.zoom")

    def test_spec_for_finds_an_installed_type(self) -> None:
        assert _registry(_spec("nova.blur")).spec_for("nova.blur") is not None

    def test_spec_for_returns_none_when_it_is_not_installed(self) -> None:
        assert _registry().spec_for("nova.blur") is None

    def test_a_non_string_type_is_never_found(self) -> None:
        assert _registry(_spec()).spec_for(None) is None

    def test_containment_is_about_the_type(self) -> None:
        assert "nova.blur" in _registry(_spec("nova.blur"))

    def test_a_missing_type_is_not_contained(self) -> None:
        assert "nova.blur" not in _registry()

    def test_specs_in_one_category(self) -> None:
        registry = _registry(
            _spec("a", category=EffectCategory.BLUR),
            _spec("b", category=EffectCategory.COLOUR),
            _spec("c", category=EffectCategory.BLUR),
        )
        assert [spec.type for spec in registry.specs_in(EffectCategory.BLUR)] == ["a", "c"]

    def test_specs_for_a_target(self) -> None:
        registry = _registry(
            _spec("a", targets=frozenset({EffectTarget.CLIP})),
            _spec("b", targets=frozenset({EffectTarget.OUTPUT})),
        )
        assert [spec.type for spec in registry.specs_for_target(EffectTarget.OUTPUT)] == ["b"]

    def test_an_effect_may_support_several_targets(self) -> None:
        spec = _spec(targets=frozenset({EffectTarget.CLIP, EffectTarget.OUTPUT}))
        registry = _registry(spec)
        assert spec.type in [s.type for s in registry.specs_for_target(EffectTarget.CLIP)]
        assert spec.type in [s.type for s in registry.specs_for_target(EffectTarget.OUTPUT)]

    def test_as_mapping_is_keyed_by_type(self) -> None:
        assert sorted(_registry(_spec("a"), _spec("b")).as_mapping()) == ["a", "b"]

    def test_two_specs_may_not_share_a_type(self) -> None:
        with pytest.raises(NovaInvariantError, match="two specs claim the type"):
            _registry(_spec("nova.blur"), _spec("nova.blur"))


class TestWriting:
    def test_registering_adds_a_spec(self) -> None:
        registry = EffectRegistry().register(_spec("nova.blur")).unwrap()
        assert len(registry) == 1

    def test_registering_returns_a_new_registry(self) -> None:
        """A plugin that fails half way through installing must leave the
        running one untouched."""
        original = EffectRegistry()
        original.register(_spec("nova.blur"))
        assert len(original) == 0

    def test_registering_a_duplicate_is_refused(self) -> None:
        registry = _registry(_spec("nova.blur"))
        result = registry.register(_spec("nova.blur"))
        assert result.is_err() is True
        assert result.unwrap_err().code == NS_EFFECT_DUPLICATE_TYPE

    def test_a_refused_registration_names_the_type(self) -> None:
        registry = _registry(_spec("nova.blur"))
        error = registry.register(_spec("nova.blur")).unwrap_err()
        assert error.details["effect_type"] == "nova.blur"

    def test_a_refused_registration_offers_a_remedy(self) -> None:
        assert _registry(_spec()).register(_spec()).unwrap_err().remedy

    def test_replace_overwrites_rather_than_refusing(self) -> None:
        """Upgrading a plugin is a deliberate act, and a caller that says
        `replace` has admitted it."""
        registry = _registry(_spec("nova.blur", version=1))
        replaced = registry.replace(_spec("nova.blur", version=2))
        assert replaced.spec_for("nova.blur") is not None
        assert replaced.spec_for("nova.blur").version == 2

    def test_replace_adds_when_the_type_is_new(self) -> None:
        assert len(EffectRegistry().replace(_spec("nova.blur"))) == 1

    def test_replace_returns_a_new_registry(self) -> None:
        original = _registry(_spec("nova.blur", version=1))
        original.replace(_spec("nova.blur", version=2))
        assert original.spec_for("nova.blur").version == 1

    def test_unregistering_withdraws_a_spec(self) -> None:
        registry = _registry(_spec("nova.blur")).unregister("nova.blur")
        assert len(registry) == 0

    def test_unregistering_twice_is_not_an_error(self) -> None:
        """A plugin disabled in the middle of a failed install must not wedge
        the registry."""
        registry = _registry(_spec("nova.blur"))
        assert len(registry.unregister("nova.blur").unregister("nova.blur")) == 0

    def test_unregistering_leaves_the_others_alone(self) -> None:
        registry = _registry(_spec("a"), _spec("b")).unregister("a")
        assert registry.types == ("b",)


class TestInstantiate:
    def test_a_fresh_effect_carries_its_type(self) -> None:
        effect = _registry(_spec("nova.blur")).instantiate("nova.blur", "e1").unwrap()
        assert (effect.effect_id, effect.type) == ("e1", "nova.blur")

    def test_a_fresh_effect_carries_the_specs_defaults(self) -> None:
        effect = _registry(_spec("nova.blur")).instantiate("nova.blur", "e1").unwrap()
        assert effect.param_at("radius", 0) == (4.0,)

    def test_a_fresh_effect_takes_a_name(self) -> None:
        effect = _registry(_spec("nova.blur")).instantiate("nova.blur", "e1", name="Soft").unwrap()
        assert effect.name == "Soft"

    def test_instantiating_an_uninstalled_type_fails(self) -> None:
        result = _registry().instantiate("nova.missing", "e1")
        assert result.unwrap_err().code == NS_EFFECT_UNKNOWN_TYPE

    def test_the_failure_names_the_type(self) -> None:
        error = _registry().instantiate("nova.missing", "e1").unwrap_err()
        assert error.details["effect_type"] == "nova.missing"

    def test_the_failure_is_not_retryable(self) -> None:
        """Installing a plugin is not something a retry loop can do."""
        assert _registry().instantiate("nova.missing", "e1").unwrap_err().retryable is False

    def test_the_failure_belongs_to_the_effect_domain(self) -> None:
        assert str(_registry().instantiate("nova.missing", "e1").unwrap_err().domain) == "EFFECT"

    def test_a_fresh_effect_is_animatable_where_the_spec_allows(self) -> None:
        spec = _spec(
            "nova.blur",
            ParameterSpec(
                name="radius",
                label="Radius",
                kind=ParamKind.SCALAR,
                default=(4.0,),
                minimum=(0.0,),
                maximum=(100.0,),
            ),
        )
        effect = _registry(spec).instantiate("nova.blur", "e1").unwrap()
        assert isinstance(effect.param("radius"), Animatable)

    def test_a_non_animatable_parameter_arrives_as_a_static_value(self) -> None:
        spec = _spec(
            "nova.blur",
            ParameterSpec(
                name="mode",
                label="Mode",
                kind=ParamKind.CHOICE,
                default="gaussian",
                choices=("gaussian", "box"),
                animatable=False,
            ),
        )
        effect = _registry(spec).instantiate("nova.blur", "e1").unwrap()
        assert isinstance(effect.param("mode"), StaticParam)


class TestValidate:
    def test_a_well_formed_effect_passes(self) -> None:
        registry = _registry(_spec("nova.blur"))
        effect = registry.instantiate("nova.blur", "e1").unwrap()
        assert registry.validate(effect).is_ok() is True

    def test_an_effect_whose_spec_is_missing_still_passes(self) -> None:
        """The project still opens and the effect is greyed out.  Refusing
        would make an optional plugin mandatory (ADR-0015 rule 3)."""
        assert _registry().validate(_effect(type_name="nova.missing")).is_ok() is True

    def test_an_effect_missing_a_declared_parameter_fails(self) -> None:
        """A project written by a newer plugin version, read by an older one."""
        registry = _registry(_spec("nova.blur"))
        effect = _effect(type_name="nova.blur")
        assert registry.validate(effect).unwrap_err().code == NS_EFFECT_SPEC_MISMATCH

    def test_a_parameter_outside_its_range_fails(self) -> None:
        registry = _registry(_spec("nova.blur"))
        effect = _effect(
            type_name="nova.blur",
            params=(Animatable.constant("radius", 900.0),),
        )
        assert registry.validate(effect).unwrap_err().code == NS_EFFECT_SPEC_MISMATCH

    def test_the_failure_carries_the_domain_sentence(self) -> None:
        """The message a support engineer reads comes from the domain, not from
        the service, so there is one phrasing of a rule and not two."""
        registry = _registry(_spec("nova.blur"))
        effect = _effect(type_name="nova.blur", params=())
        error = registry.validate(effect).unwrap_err()
        assert "radius" in error.message
        assert effect.effect_id in error.message

    def test_an_unknown_parameter_fails(self) -> None:
        registry = _registry(_spec("nova.blur"))
        effect = _effect(
            type_name="nova.blur",
            params=(
                Animatable.constant("radius", 4.0),
                Animatable.constant("not-a-parameter", 1.0),
            ),
        )
        assert registry.validate(effect).is_err() is True

    def test_a_keyframed_parameter_is_validated_too(self) -> None:
        """A keyframe added later can be anything, which is why validation is a
        service and not an invariant."""
        registry = _registry(_spec("nova.blur"))
        out_of_range = (
            Animatable.constant("radius", 4.0)
            .with_keyframe(Keyframe.at(0, 4.0))
            .with_keyframe(Keyframe.at(10, 900.0))
        )
        effect = _effect(type_name="nova.blur", params=(out_of_range,))
        assert registry.validate(effect).is_err() is True

    def test_a_whole_chain_can_be_validated(self) -> None:
        registry = _registry(_spec("nova.blur"))
        chain = EffectChain(effects=(registry.instantiate("nova.blur", "e1").unwrap(),))
        assert registry.validate_chain(chain).is_ok() is True

    def test_a_chain_skips_effects_whose_spec_is_missing(self) -> None:
        registry = _registry(_spec("nova.blur"))
        chain = EffectChain(
            effects=(
                registry.instantiate("nova.blur", "e1").unwrap(),
                _effect(effect_id="e2", type_name="nova.missing"),
            )
        )
        assert registry.validate_chain(chain).is_ok() is True

    def test_a_chain_reports_a_broken_effect(self) -> None:
        registry = _registry(_spec("nova.blur"))
        chain = EffectChain(
            effects=(_effect(type_name="nova.blur", params=(Animatable.constant("radius", -5.0),)),)
        )
        assert registry.validate_chain(chain).unwrap_err().code == NS_EFFECT_SPEC_MISMATCH
