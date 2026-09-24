"""L3 — application services: use cases, engines and orchestration.

A service turns an intent ("export this timeline at 1080p", "caption this clip and
translate it to Japanese") into a sequence of domain operations and port calls.  It
owns *workflow*; the domain owns *truth*; the adapters own *mechanics*.

Hard rules, enforced by ``scripts/check_layering.py``:

1. **Depends on ``ports``, never on ``infra``.**  Adapters arrive from the DI
   container.  A service that writes ``import av`` has silently acquired FFmpeg as
   a test dependency and can no longer be exercised without it.
2. **Feature isolation.**  A module in ``services/render`` may not import from
   ``services/captions``, and vice versa.  Each feature is independently
   replaceable, so they collaborate through ``ports`` and the ``EventBus`` rather
   than through each other's internals.  The one exception is
   ``services/shared``, the deliberate kernel for cross-feature helpers.
3. **May import** ``core``, ``domain``, ``ports``, ``services.shared`` and its own
   feature.  May not import ``infra`` or ``api``.
4. **Long-running work goes through the job scheduler**, not a bare thread
   (ADR-0010).  A service that spawns its own thread cannot be cancelled,
   prioritised, rate-limited or recovered after a crash.

Features (populated in Stages 3–12)::

    projects/      open, save, autosave, crash recovery
    media/         ingest, probing, thumbnails, proxy generation
    timeline/      edit operations as commands, undo scopes, ripple logic
    render/        the frame pipeline: decode → graph → composite → encode
    captions/      the caption engine — three-pass ASR, alignment, styling
    effects/       effect graph evaluation and parameter animation
    export/        presets, queueing, packaging
    ai/            AI Studio orchestration on top of captions and effects
    plugins/       manifest validation, permission audit, lifecycle
    jobs/          scheduler, admission control, circuit breaker
    shared/        cross-feature helpers (the sanctioned exception to rule 2)

Error discipline: services return ``Result[T]``.  They reserve exceptions for
invariant breaches they cannot recover from, so that a caller can distinguish
"this export cannot proceed, here is why" from "this program is wrong".
"""

from __future__ import annotations
