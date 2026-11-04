"""L3 — the effect registry: which effects exist, and what they accept.

The domain decides what an effect *is*; this decides which ones this install
*has*.  Keeping that here rather than in the domain is what makes a
third-party effect indistinguishable from a built-in one: both arrive as an
:class:`~nova_studio.domain.effects.EffectSpec`, published by a plugin at
startup, and nothing downstream can tell them apart (ADR-0011).

Three rules come out of that.

**The registry is a value.**  :meth:`EffectRegistry.register` returns a *new*
registry rather than mutating one.  A plugin that fails to install therefore
leaves the running one untouched, a snapshot for the render worker is a
reference rather than a deep copy, and a test needs no teardown.

**A missing spec is a state, not an error.**  A project that names an effect
whose plugin is not installed must still open — that is ADR-0015 rule 3 applied
to effects, and it is why :meth:`validate` returns ``Ok`` for an effect it has
never heard of.  Refusing to open would make an optional plugin mandatory.

**Everything else is a ``Result``.**  "That effect is not installed" and "this
effect's parameters do not match its spec" are things a user can act on, so
they come back as :class:`~nova_studio.core.result.Err` carrying a stable
``NS-EFFECT-4xxx`` code the UI localises by.  Only a programming error — two
specs claiming one type in a hand-built registry — raises.

Deliberately not here: **pixels**, **files** and **processes**.  A spec is
metadata; running an effect is the render engine's job (§7.2), loading a plugin
is the plugin service's, and discovering which plugins exist is a manifest
read in ``infra``.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.effects import (
    Effect,
    EffectCategory,
    EffectChain,
    EffectSpec,
    EffectTarget,
    validate_chain,
    validate_effect,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

__all__ = [
    "NS_EFFECT_DUPLICATE_TYPE",
    "NS_EFFECT_SPEC_MISMATCH",
    "NS_EFFECT_UNKNOWN_TYPE",
    "EffectRegistry",
]

#: The effect type is not installed on this machine.
NS_EFFECT_UNKNOWN_TYPE: Final[str] = "NS-EFFECT-4001"
#: The effect instance does not match the spec that describes it.
NS_EFFECT_SPEC_MISMATCH: Final[str] = "NS-EFFECT-4002"
#: Two specs claim the same type.  A plugin may not shadow a built-in by
#: accident, and two plugins may not fight over one name.
NS_EFFECT_DUPLICATE_TYPE: Final[str] = "NS-EFFECT-4003"


def _unknown_type(effect_type: str) -> NovaError:
    return NovaError(
        code=NS_EFFECT_UNKNOWN_TYPE,
        message=f"no effect of type '{effect_type}' is installed",
        domain=ErrorDomain.EFFECT,
        details={"effect_type": effect_type},
        remedy="Install the plugin that provides this effect, or remove it from the project.",
        retryable=False,
    )


def _mismatch(effect: Effect, problem: str) -> NovaError:
    return NovaError(
        code=NS_EFFECT_SPEC_MISMATCH,
        message=problem,
        domain=ErrorDomain.EFFECT,
        details={"effect_id": effect.effect_id, "effect_type": effect.type},
        remedy="Reset the effect to its defaults, or update the plugin that provides it.",
        retryable=False,
    )


def _duplicate(effect_type: str, holder: str) -> NovaError:
    return NovaError(
        code=NS_EFFECT_DUPLICATE_TYPE,
        message=f"an effect of type '{effect_type}' is already registered{holder}",
        domain=ErrorDomain.EFFECT,
        details={"effect_type": effect_type},
        remedy="Unregister the existing effect first, or version the plugin's type name.",
        retryable=False,
    )


@dataclass(frozen=True, slots=True)
class EffectRegistry:
    """The catalogue of effect specs this install can instantiate.

    Iteration order is the type name, so the effect browser is stable between
    runs and a test can assert on it without sorting.
    """

    specs: tuple[EffectSpec, ...] = ()

    def __post_init__(self) -> None:
        seen: set[str] = set()
        for spec in self.specs:
            if spec.type in seen:
                raise NovaInvariantError(
                    f"two specs claim the type '{spec.type}'; "
                    "register() refuses this at runtime, so a hand-built registry "
                    "has been assembled wrongly"
                )
            seen.add(spec.type)
        object.__setattr__(self, "specs", tuple(sorted(self.specs, key=lambda s: s.type)))

    # -- reading ------------------------------------------------------------

    def __len__(self) -> int:
        return len(self.specs)

    def __contains__(self, effect_type: object) -> bool:
        return self.spec_for(effect_type) is not None

    @property
    def types(self) -> tuple[str, ...]:
        """Every installed effect type, sorted."""
        return tuple(spec.type for spec in self.specs)

    def spec_for(self, effect_type: object) -> EffectSpec | None:
        """The spec for one type, or ``None`` when it is not installed."""
        if not isinstance(effect_type, str):
            return None
        for spec in self.specs:
            if spec.type == effect_type:
                return spec
        return None

    def specs_in(self, category: EffectCategory) -> tuple[EffectSpec, ...]:
        """Every effect in one browser category."""
        return tuple(spec for spec in self.specs if spec.category is category)

    def specs_for_target(self, target: EffectTarget) -> tuple[EffectSpec, ...]:
        """Every effect that may be attached to a clip, a track or the output.

        The inspector offers only these, which is how "why can I not put a
        lens blur on the output grade" is answered before the user asks it.
        """
        return tuple(spec for spec in self.specs if spec.supports(target))

    def as_mapping(self) -> Mapping[str, EffectSpec]:
        """The specs as a mapping, for the domain validators and the renderer."""
        return {spec.type: spec for spec in self.specs}

    # -- writing ------------------------------------------------------------

    def register(self, spec: EffectSpec) -> Result[EffectRegistry]:
        """Publish one spec.

        Fails rather than shadows: a plugin that silently replaced a built-in
        would change the look of every project that uses that effect, which is
        the worst possible way to discover a name collision.
        """
        holder = self.spec_for(spec.type)
        if holder is not None:
            return failed(_duplicate(spec.type, f" (version {holder.version})"))
        return ok(replace(self, specs=(*self.specs, spec)))

    def replace(self, spec: EffectSpec) -> EffectRegistry:
        """Publish one spec, replacing whatever claimed the type before.

        This is the explicit form of :meth:`register`: upgrading a plugin is a
        deliberate act, and a caller that says ``replace`` has admitted it.
        """
        kept = tuple(item for item in self.specs if item.type != spec.type)
        return replace(self, specs=(*kept, spec))

    def unregister(self, effect_type: str) -> EffectRegistry:
        """Withdraw one spec.

        Idempotent, because uninstalling twice is not an error: a plugin being
        disabled in the middle of a failed install must not wedge the registry.
        """
        kept = tuple(spec for spec in self.specs if spec.type != effect_type)
        return replace(self, specs=kept)

    # -- building and checking ----------------------------------------------

    def instantiate(
        self,
        effect_type: str,
        effect_id: str,
        *,
        name: str = "",
    ) -> Result[Effect]:
        """A fresh effect of one type, at its spec's default parameters.

        This is what "drag an effect onto a clip" calls.  The parameters come
        from the spec, so a plugin that ships sensible defaults gets them for
        free and a project saved by a newer version of the plugin is still
        readable here.
        """
        spec = self.spec_for(effect_type)
        if spec is None:
            return failed(_unknown_type(effect_type))
        return ok(Effect.for_spec(effect_id, spec, name=name))

    def validate(self, effect: Effect) -> Result[Effect]:
        """Check one effect instance against the spec that describes it.

        An effect whose spec is not installed passes: the project still opens
        and the effect is greyed out in the inspector.  That is ADR-0015 rule 3
        — refusing to open would make an optional plugin mandatory.
        """
        spec = self.spec_for(effect.type)
        if spec is None:
            return ok(effect)
        problem = validate_effect(effect, spec)
        if problem:
            return failed(_mismatch(effect, problem))
        return ok(effect)

    def validate_chain(self, chain: EffectChain) -> Result[EffectChain]:
        """Check every effect in a chain that has a spec installed."""
        problem = validate_chain(chain, self.as_mapping())
        if problem:
            return failed(
                NovaError(
                    code=NS_EFFECT_SPEC_MISMATCH,
                    message=problem,
                    domain=ErrorDomain.EFFECT,
                    remedy="Reset the effect to its defaults, or update the plugin that provides it.",
                    retryable=False,
                )
            )
        return ok(chain)
