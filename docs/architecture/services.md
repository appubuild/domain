# The service layer (L3)

**Status:** Living document · **Owner:** Architecture Group · **Last reviewed:** 2026-11-02

The layer between *what a project is* (`domain`) and *how the mechanics work*
(`infra`). This document is the house style for every feature package under
`nova_studio/services/` and the record of what each one owns.

---

## 1. Purpose and rules

A service turns an intent — "export this timeline at 1080p", "caption this clip
and translate it to Japanese", "apply a blur to this clip" — into a sequence of
domain operations and port calls. It owns **workflow**; the domain owns
**truth**; the adapters own **mechanics**.

Four rules, all enforced by `scripts/check_layering.py`:

1. **Depends on `ports`, never on `infra`.** Adapters arrive from the DI
   container. A service that writes `import av` has silently acquired FFmpeg as
   a test dependency and can no longer be exercised without it.
2. **Feature isolation.** A module in `services/render` may not import from
   `services/captions`, and vice versa. Each feature is independently
   replaceable, so they collaborate through `ports` and the `EventBus` rather
   than through each other's internals. The one exception is `services/shared`,
   the deliberate kernel for cross-feature helpers.
3. **May import** `core`, `domain`, `ports`, `services.shared` and its own
   feature package. May not import `infra` or `api`.
4. **Long-running work goes through the job scheduler**, not a bare thread
   (ADR-0010). A service that spawns its own thread cannot be cancelled,
   prioritised, rate-limited or recovered after a crash.

**Error discipline.** Services return `Result[T]` from `core/result.py`. They
reserve exceptions for invariant breaches they cannot recover from, so a caller
can distinguish "this export cannot proceed, here is why" from "this program is
wrong". Every failure carries a stable `NS-<DOMAIN>-<NNNN>` code the UI
localises by; the message is the developer's fallback and the log's text.

**Database schema.** None. Services own no tables: the per-project store is a
derived index rebuilt from `timeline/document.json`, and its schema belongs to
`infra/persistence` (ADR-0004 §3, [`project-file-format.md`](project-file-format.md)).

---

## 2. Folder structure

```
services/
├── shared/       cross-feature helpers (the sanctioned exception to rule 2)
├── projects/     open, save, autosave, crash recovery
├── media/        ingest, probing, thumbnails, proxy generation
├── timeline/     edit operations as commands, undo scopes, ripple logic
├── render/       the frame pipeline: decode → graph → composite → encode
├── captions/     the caption engine — three-pass ASR, alignment, styling
├── effects/      the effect catalogue and the graph it builds   ← built
├── export/       presets, queueing, packaging
├── ai/           AI Studio orchestration on top of captions and effects
├── plugins/      manifest validation, permission audit, lifecycle
└── jobs/         scheduler, admission control, circuit breaker
```

Each feature package carries a module docstring with the same fourteen headings
used in §3 — purpose, structure, backend/frontend architecture, state,
functions, events, errors, caching, performance, testing, future expansion — so
a feature is documented where it is read.

---

## 3. Feature: `services/effects/`

**Purpose.** Own everything about an effect that is not *what an effect is*
(that is `domain/effects.py`) and not *how an effect is computed* (the render
engine, §7.2 of [`media-and-rendering.md`](media-and-rendering.md)): which
effects this install has, what a fresh instance of one looks like, and whether
an effect found in a project file still matches the spec that describes it.

**Backend / frontend.** The registry is the backend of the effect browser and
the effect inspector. The frontend holds no spec of its own: it asks for
`specs_in(category)` to draw the browser, `specs_for_target` to decide what may
be dropped where, and `instantiate` when the user drops one. A parameter
control is generated from a `ParameterSpec` — kind, range, step, unit, hint and
whether a stopwatch is offered — so a plugin that ships a new effect gets a
finished inspector with no frontend code at all (ADR-0011).

**Class diagram.**

```
EffectRegistry (frozen value)
├── specs: tuple[EffectSpec, ...]        sorted by type
├── spec_for(type) → EffectSpec | None
├── specs_in(category) / specs_for_target(target)
├── register(spec)  → Result[EffectRegistry]     refuses to shadow
├── replace(spec)   → EffectRegistry             explicit override
├── unregister(type)→ EffectRegistry             idempotent
├── instantiate(type, id) → Result[Effect]       spec's defaults
├── validate(effect) → Result[Effect]            missing spec ⇒ Ok
└── validate_chain(chain) → Result[EffectChain]

builtins.py  —  BUILTIN_TYPES, builtin_specs(), builtin_registry()
```

**State management.** No mutable state survives a call. `register`, `replace`
and `unregister` each return a new registry, so a snapshot handed to a render
worker cannot be changed underneath it by a plugin that installs mid-render,
and a test needs no teardown. The DI container holds the current registry;
swapping it is one assignment.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `builtin_registry()` | "what do we have before plugins" |
| `register` / `replace` / `unregister` | "add, upgrade or withdraw one effect" |
| `spec_for` / `in` / `types` | "do we have this one" |
| `specs_in` / `specs_for_target` | "what goes in this drawer, what can go here" |
| `instantiate(type, id)` | "give me a fresh one, at its defaults" |
| `validate` / `validate_chain` | "does this one from a project file still make sense" |

**Events.** None yet. When the plugin service gains a lifecycle, publishing will
emit `plugin.effect.registered` / `plugin.effect.withdrawn` on the `EventBus`
(`core/events.py`) so an open project can re-audit its chains. The registry
itself stays silent, so a test never has to drain a bus.

**Error handling.**

| Code | Meaning | Retryable |
| --- | --- | --- |
| `NS-EFFECT-4001` | The effect type is not installed here. | No — install the plugin. |
| `NS-EFFECT-4002` | An effect instance does not match its spec. | No — reset or update. |
| `NS-EFFECT-4003` | Two specs claim one type. | No — a name collision needs a human. |

**Caching.** `as_mapping()` builds a dictionary per call, deliberately: the
mapping is handed to domain validators that must not see it change, and a
registry holds dozens of specs, not thousands. If the catalogue ever grows to
where this matters, the cache belongs in the caller, which knows its own
lifetime.

**Performance.** Lookups are linear over a tuple of specs — tens of entries,
called when a user opens a panel, not per frame. The per-frame path is the
renderer's, and it never sees this module.

**Testing.** `tests/services/test_effects_registry.py` pins immutability, the
refusal to shadow, the "not installed still opens" rule and the error codes.
`tests/services/test_effects_builtins.py` pins that every built-in
instantiates, validates and carries defaults inside its own bounds — the
cheapest guard against a catalogue drifting out of step with the domain.

**Future expansion.**

* **Versioned specs.** `EffectSpec.version` is carried but not yet enforced;
  migrating an older instance belongs here, next to `validate`.
* **Presets.** Named parameter sets (a look, a house style) are a catalogue
  concern and will sit beside `builtins`.
* **Audio effects.** `EffectSpec.is_audio` exists; an audio registry will share
  this one when the mixer lands (§7.4).

---

## 4. Conventions a new feature must follow

1. **A package, not a module**, once it holds more than one concern.
2. **`Result[T]` across the boundary**, `NovaInvariantError` only for bugs.
3. **Frozen values in, frozen values out**, so a snapshot is a safe thing to
   hand to a worker.
4. **No I/O**, no clock, no `random` — those arrive as ports
   (`ports/clock.py`, `ports/ident.py`).
5. **A feature docstring with the fourteen headings**, written before the code
   that makes it true.
6. **Tests under `tests/services/`** with `pytestmark = pytest.mark.unit`, one
   behaviour per test, no shared mutable fixtures.
