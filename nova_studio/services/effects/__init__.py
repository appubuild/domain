"""L3 feature — effects: the catalogue and the graph it builds.

**Purpose.** Own everything about an effect that is not *what an effect is*
(that is ``domain/effects.py``) and not *how an effect is computed* (that is
the render engine, §7.2): which effects this install has, what a fresh instance
of one looks like, and whether an effect found in a project file still matches
the spec that describes it.

**Folder structure.**

```
services/effects/
├── __init__.py   this file: the feature's contract
├── registry.py   EffectRegistry — publish, look up, instantiate, validate
└── builtins.py   the catalogue Nova Studio ships before any plugin is added
```

**Backend/frontend architecture.** The registry is the backend of the effect
browser and the effect inspector.  The frontend never holds a spec of its own:
it asks for ``specs_in(category)`` to draw the browser, ``specs_for_target`` to
decide what may be dropped where, and ``instantiate`` when the user drops one.
A parameter control is generated from a ``ParameterSpec`` — kind, range, step,
unit, hint and whether a stopwatch is offered — so a plugin that ships a new
effect gets a finished inspector without a line of frontend code (ADR-0011).

**State management.** No mutable state survives a call.  ``register``,
``replace`` and ``unregister`` each return a new registry, so a snapshot handed
to a render worker cannot be changed underneath it by a plugin that installs
mid-render, and a test needs no teardown.  The DI container holds the current
registry; swapping it is one assignment.

**Functions.**

| Call | Answers |
| --- | --- |
| ``builtin_registry()`` | "what do we have before plugins" |
| ``register(spec)`` / ``replace(spec)`` / ``unregister(type)`` | "add, upgrade or withdraw one effect" |
| ``spec_for(type)`` / ``__contains__`` / ``types`` | "do we have this one" |
| ``specs_in(category)`` / ``specs_for_target(target)`` | "what goes in this drawer, what can go here" |
| ``instantiate(type, id)`` | "give me a fresh one, at its defaults" |
| ``validate(effect)`` / ``validate_chain(chain)`` | "does this one from a project file still make sense" |

**Events.** None yet.  When the plugin service gains a lifecycle, publishing
will emit ``plugin.effect.registered`` / ``plugin.effect.withdrawn`` on the
``EventBus`` (``core/events.py``) so an open project can re-audit its chains.
The registry itself stays silent, so a test never has to drain a bus.

**Error handling.** Services return ``Result[T]``; exceptions are reserved for
bugs.  The stable codes are:

| Code | Meaning | Retryable |
| --- | --- | --- |
| ``NS-EFFECT-4001`` | The effect type is not installed here. | No — install the plugin. |
| ``NS-EFFECT-4002`` | An effect instance does not match its spec. | No — reset or update. |
| ``NS-EFFECT-4003`` | Two specs claim one type. | No — a name collision needs a human. |

**Caching.** ``as_mapping()`` builds a dictionary per call.  That is deliberate:
the mapping is handed to domain validators that must not see it change, and a
registry holds dozens of specs, not thousands.  If the catalogue ever grows to
where this matters, the cache belongs in the caller, which knows its own
lifetime.

**Performance.** Lookups are linear over a tuple of specs — tens of entries,
called when a user opens a panel, not per frame.  The per-frame path is the
renderer's, and it never sees this module.

**Testing.** ``tests/services/test_effects_registry.py`` pins the immutability,
the refusal to shadow, the "not installed still opens" rule, and the error
codes. ``tests/services/test_effects_builtins.py`` pins that every built-in
instantiates and validates — the cheapest possible guard against a catalogue
that drifts out of step with the domain.

**Future expansion.**

* **Versioned specs.** ``EffectSpec.version`` is carried but not yet enforced;
  the migration of an older instance belongs here, next to ``validate``.
* **Parameter presets.** Named parameter sets (a look, a house style) are a
  catalogue concern and will sit beside ``builtins``.
* **Audio effects.** ``EffectSpec.is_audio`` exists; an audio registry will
  share this one when the mixer lands (§7.4).
"""

from __future__ import annotations

from nova_studio.services.effects.builtins import (
    BUILTIN_TYPES,
    builtin_registry,
    builtin_specs,
)
from nova_studio.services.effects.registry import (
    NS_EFFECT_DUPLICATE_TYPE,
    NS_EFFECT_SPEC_MISMATCH,
    NS_EFFECT_UNKNOWN_TYPE,
    EffectRegistry,
)

__all__ = [
    "BUILTIN_TYPES",
    "NS_EFFECT_DUPLICATE_TYPE",
    "NS_EFFECT_SPEC_MISMATCH",
    "NS_EFFECT_UNKNOWN_TYPE",
    "EffectRegistry",
    "builtin_registry",
    "builtin_specs",
]
