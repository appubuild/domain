# ADR-0008 — Command pattern with per-scope undo stacks and coalescing

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

Undo/redo in an NLE is harder than in a text editor because:

* Operations are **continuous**: a clip drag produces hundreds of intermediate positions.
  Undoing should revert *the gesture*, not the last mouse-move.
* Operations have **different scopes**: undoing a caption style tweak must not undo a
  structural timeline edit the user made five minutes ago in a different context — yet both
  are "the last thing I did" from the user's point of view.
* Operations have **side effects beyond state**: cache invalidation, waveform regeneration,
  preview re-render, autosave marking, and UI events.
* Some operations are **not undoable by construction** (a destructive media delete after the
  trash is emptied, an export, a background AI job).

A single global memento/undo tree would either explode in memory (snapshotting a 40 000-keyframe
timeline per gesture) or fail the scope requirement.

## Decision

1. **Every project mutation is a `Command`** (`core/commands.py`). There is no other way to
   change project state; services expose `execute(command)`, not mutators. Commands are
   objects, so they are serialisable, loggable, testable, mappable to shortcuts and
   replayable.
2. A command implements `execute`, `undo`, and `merge_with`. `undo` must be the exact
   inverse — implemented as **captured deltas**, not snapshots. A `MoveClipCommand` stores
   `(clip_id, old_track, old_start, new_track, new_start)`: 4 integers, not a timeline copy.
   Where a delta is genuinely unbounded (paste of a large subgraph), the command stores a
   compressed structural delta and declares `memory_class = HEAVY` so the stack can bound it.
3. **Coalescing via `merge_with`.** The stack asks the incoming command whether it merges
   with the top of the stack: same `command_id`, same target, same gesture token, and within
   a time window (default 700 ms). A drag produces one undo entry. A slider produces one
   entry per user interaction. Text editing coalesces per word-boundary. Merge policy is
   declared by the command, not centrally.
4. **Per-scope stacks.** `UndoScope` ∈ {`GLOBAL`, `TIMELINE`, `CAPTION`, `COLOUR`,
   `INSPECTOR`}. Each scope has its own stack, and the UI shows one Undo action whose target
   is the *focused scope*, with a global "Undo (Timeline)" fallback in the menu. This matches
   how editors actually work and prevents cross-context destruction.
5. **Bounded stacks** per scope (default 200 entries, configurable) with heavy-command
   accounting; when the budget is exceeded the oldest heavy commands are dropped first.
6. **Side effects are subscribers, not call sites.** Executing a command publishes
   `command.executed` with the command id, affected entity ids and an invalidation set.
   Cache invalidation, preview re-render, autosave dirty-marking, WS broadcast and telemetry
   all subscribe. Adding a reaction requires no change to any command (Open/Closed).
7. **Non-undoable operations** are modelled as `Job`s, not `Command`s (ADR-0010), so they
   cannot pollute the undo stack.
8. **Redo is cleared on divergence** within the affected scope only; other scopes keep their
   redo stacks.

## Consequences

**Positive**

* Memory is bounded and predictable regardless of project size.
* Undo behaves as users expect for gestures, sliders and text.
* Because every mutation is a serialised command, we get the **event log for free** — which
  is the foundation of autosave deltas, crash recovery (ADR-0015 §6), scripting, and any
  future collaboration support.
* Commands are trivially unit-testable with a fake `CommandContext`.

**Negative / accepted**

* Writing `undo` for every command is real work and a source of bugs if done carelessly.
  Mitigated by a `CommandRoundTrip` property test harness that executes → undoes → asserts
  byte-identical serialised state for every registered command, run in CI. Any command that
  cannot pass is not allowed to merge.
* Cross-scope invariants (e.g. deleting an asset that caption clips reference) need care:
  such commands declare `scope = GLOBAL` and perform the cascade inside one transaction.
* Coalescing windows are heuristic; a too-long window would swallow distinct edits. Tunable
  in settings, defaults chosen from measured gesture durations.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Memento snapshots of the whole project | Memory blows up on large timelines; a 40 000-keyframe project would snapshot megabytes per gesture |
| Event sourcing with full replay | Replay cost grows without bound; needs snapshots anyway; too much machinery for a single-user desktop app — though our command log is a step toward it |
| Single global undo stack | Fails the scope requirement; caption styling undo would destroy structural edits |
| Library-based undo (e.g. immutable-data diffing) | Diffing a whole timeline per gesture is slower than storing a 4-integer delta |
| Mutator methods on services | Untestable, unserialisable, no undo, no event stream — the classic dead end |
