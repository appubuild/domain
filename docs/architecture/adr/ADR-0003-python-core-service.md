# ADR-0003 — Python core service as the single authority for project state

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

The product requirement fixes the backend at Python (FastAPI, PyAV, FFmpeg, OpenCV, NumPy,
Pillow, faster-whisper) and the frontend at React/TypeScript. That split forces a decision
about **who owns the truth** for project state.

Three options exist in practice:

* **(A)** The browser owns state and sends diffs to Python for rendering.
* **(B)** Python owns state; the UI is a projection of it.
* **(C)** Both hold state and reconcile.

Option (A) is what several web-based editors do, and it collapses under three Nova Studio
requirements: frame-accurate integer timebase arithmetic, ASR/AI jobs that outlive any UI
session, and crash recovery that must reconstruct an exact timeline. Option (C) is a
distributed-systems problem we would be signing up to solve forever.

## Decision

**Python is the single authority.** Specifically:

1. All project state lives in the core service (SQLite + in-memory project session).
2. The frontend holds **derived, UI-only** state (selection, scroll position, hover, panel
   layout, drag preview) and an optimistic mirror of project state.
3. Every mutation travels as a `Command` to the backend; the backend applies it inside a
   transaction, then broadcasts the authoritative event. The frontend reconciles its mirror
   from that event.
4. Optimistic UI is allowed for latency-critical interactions (clip drag, transport scrub,
   caption text edit). An optimistic update is tagged with the `command_id`; when the
   authoritative event arrives with the same id, the mirror is replaced, not merged. If the
   command fails, the mirror is rolled back by re-fetching the affected slice.
5. Nothing that affects the exported artefact may be computed only in the browser. Preview
   overlays (guides, gizmos, safe areas) are explicitly UI-only and are re-derived by the
   compositor at export time from the same data.

## Consequences

**Positive**

* Export and preview are guaranteed identical: one compositor, one code path (§7.2).
* Undo/redo, autosave, crash recovery and the event log all live in one place.
* Headless operation (CLI render, CI test, future farm render) is a first-class mode.
* AI jobs continue when the window is closed or the UI reloads.

**Negative / accepted**

* Every interaction has a round-trip. On loopback this is 0.1–1 ms, well inside budget; for
  drag operations we combine optimistic UI with command coalescing so the round-trip count
  stays ~1 per gesture, not per mouse event.
* The frontend must handle reconciliation. Mitigated by a single, well-tested reconciler in
  `core/events/` rather than ad-hoc logic per feature.
* Python's GIL constrains concurrency. Mitigated by ADR-0010 (process pool for CPU-heavy
  export/AI) and by keeping the request path off the hot loop.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Browser-authoritative state | Frame accuracy, offline AI jobs, and crash recovery all need server-side truth |
| Dual-authority with CRDT sync | Enormous complexity for a single-user desktop app; revisit only if collaboration ships |
| Rust/C++ core with Python bindings | Would likely be faster, but contradicts the product requirement and forfeits the PyAV/faster-whisper/OpenCV ecosystem; the perf gap is closed by ADR-0010 and ADR-0012 |
| Electron + Node core | Two runtimes, larger package, and no access to the Python media/AI ecosystem |
