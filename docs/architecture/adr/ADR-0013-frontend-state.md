# ADR-0013 — Zustand slices as ViewModels; views never call the API

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

The editor UI has unusual state characteristics:

* **Very high update frequency**: transport position at display rate, timeline drag,
  waveform scroll, hover/selection.
* **Many independent consumers**: the ruler, a clip, the inspector and the status bar all
  need the playhead, but re-rendering all of them per frame is a non-starter.
* **Server-authoritative state** (ADR-0003): local state is a mirror that must reconcile.
* **Persistent, serialisable UI state**: dock layout, panel sizes, theme, recent projects.

Redux-style global stores cause selector boilerplate and re-render storms in editors;
context-based state re-renders subtrees on every change; component-local state cannot be
shared across docks. We also need MVVM per the requirements, with testable ViewModels.

## Decision

1. **Zustand with feature slices** (`frontend/src/stores/`) is the ViewModel layer. One
   store per bounded context: `project`, `timeline`, `media`, `playback`, `captions`,
   `export`, `ai`, `settings`, `ui`, `plugins`, `performance`. Slices are composed into a
   single store with namespaced action creators, so cross-slice reads are possible without
   prop drilling.
2. **Selector discipline is mandatory.** Components subscribe with the narrowest possible
   selector and use `useShallow` for object/array results. A component may not select a whole
   slice. Enforced by an ESLint rule (`no-store-wide-selectors`) and by a render-count
   assertion in component tests.
3. **Views never call the API client.** A component reads a store and dispatches an
   **action**. Actions own: validation, optimistic update, API call, reconciliation,
   error/telemetry. This makes every interaction testable by invoking an action against a
   mocked transport, with no rendering involved, and it is the mechanical expression of MVVM.
4. **The transport is a single typed client** (`core/api/client.ts`) generated from the
   backend contract. It owns: base URL + session token, request ids, timeouts, retry with
   jittered backoff for idempotent GETs only, `AbortController` cancellation keyed by
   request id, and problem+json error decoding into typed `NovaClientError`.
5. **Server events flow one way**: WS → `core/events/bridge.ts` → topic→action map → store
   patch. No component subscribes to the WS directly. Gap detection (`seq`) triggers a
   slice resync.
6. **Ephemeral vs authoritative state is separated explicitly.** Playhead position during
   scrubbing is ephemeral and lives in a mutable ref-backed store that does not trigger React
   re-render; it drives the canvas timeline directly via an imperative subscription. Once the
   gesture ends, the authoritative position is committed through an action. This is how the
   timeline stays at 60+ fps while React re-renders only on real state changes.
7. **Persistence**: `ui`, `settings` and `project.layout` slices persist to
   `localStorage` *and* mirror to the backend `settings`/`ui_layout` tables so the state
   follows the user across machines/installs. Backend wins on conflict, with the local copy
   used for instant first paint.
8. **React Query is used only for genuinely cacheable server collections** (media library
   listings, template store, export history, plugin list) — not for timeline state, which is
   mirrored, event-driven, and must not be refetched.

## Consequences

**Positive**

* Predictable re-render behaviour; the timeline can be profiled and optimised per selector.
* ViewModels are plain functions → fast, deterministic unit tests without a DOM.
* One place where optimistic updates and reconciliation happen, so drift bugs are findable.
* Dock layout/theme persistence is data, therefore shippable as presets.

**Negative / accepted**

* Two state systems (Zustand mirror + React Query caches) — mitigated by a bright line:
  *project state* in Zustand, *server collections* in React Query, never both.
* Imperative non-React canvas subscriptions bypass the usual mental model; they are confined
  to `features/editor/timeline/canvas` and `features/editor/preview`, and documented there.
* Optimistic updates can show state the backend later rejects; rollback is implemented per
  action and covered by tests for every mutating action.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Redux Toolkit | Viable, but selector/action boilerplate is heavier and re-render control needs more ceremony for 60 fps canvas work |
| Jotai / atomic model | Great for fine granularity, awkward for the large coherent slices (timeline document) we need to reason about as a unit |
| MobX | Excellent ergonomics, but implicit reactivity makes render behaviour harder to audit in a perf-critical canvas UI |
| React Context + reducers | Re-renders whole subtrees on any change; unusable at playhead frequency |
| Component-local state with event emitter | No single source of truth; reconciliation logic duplicated per feature |
| XState for everything | Powerful, but modelling a 40 000-keyframe timeline as a state machine is the wrong abstraction; state machines are used where they fit (export wizard, ASR job lifecycle) |
