# ADR-0010 — Unified job scheduler with priorities and process isolation

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

The requirements list background rendering, background AI tasks, thumbnails, waveforms,
proxies, scene detection, silence removal and export — all of which must not block the UI.
Python's GIL means a CPU-bound compositing or ASR loop in a thread *will* starve the request
path. Conversely, a process pool has serialisation costs that make it wrong for small,
latency-critical work like a single thumbnail.

We must also handle: cancellation (users abort exports constantly), progress reporting at
sub-second cadence, crash isolation (an FFmpeg decode that segfaults must not kill the
editor), persistence (an export resumed or reported after a crash), and priority inversion
(a background AI job must not delay the frame the user is looking at).

## Decision

1. **One scheduler, five priority classes** (`core/jobs.py`):

   | Priority | Semantics | Pool | Examples |
   | --- | --- | --- | --- |
   | `CRITICAL` | user is blocked waiting | threads | thumbnail of a just-dropped clip, probe |
   | `HIGH` | next frames needed for playback | threads | preview render of visible range |
   | `NORMAL` | user-initiated long work | processes | export, proxy transcode |
   | `LOW` | background AI | processes | ASR, scene detect, auto-reframe |
   | `IDLE` | opportunistic | threads | waveform pre-generation, cache warm-up |

   Preemption is by *admission*, not by killing running work: a `HIGH` request is admitted
   immediately if a slot exists, otherwise the lowest-priority queued job is deferred.
   Running jobs are never killed for priority reasons — only for cancellation or shutdown.

2. **Pool selection is by job declaration, not by guesswork.** A `JobSpec` declares
   `isolation = THREAD | PROCESS`, `cancellable`, `idempotent`, `max_retries`,
   `memory_class`, and `affinity` (e.g. `GPU`). The scheduler validates that a `PROCESS` job
   has a picklable payload and that a `THREAD` job is not CPU-bound-heavy (a lint/test rule).

3. **Progress is a first-class channel.** Jobs call `ctx.report(progress, stage, eta, detail)`;
   the scheduler throttles to ≤ 20 Hz per job and publishes `job.progressed` on the event
   bus → WS → UI. Partial results (ASR partial hypotheses, first-pass export frames) use the
   same channel with a `payload` field.

4. **Cancellation is cooperative with a hard deadline.** `ctx.is_cancelled()` is polled in
   job loops; a `cancel()` sets the flag and arms a watchdog that terminates the process
   after `grace_period` (default 5 s, 30 s for exports mid-mux to avoid corrupt files).
   A cancelled export leaves no partial output visible to the user: writes go to a temp path
   and are promoted atomically only on success.

5. **Crash isolation.** Process-pool workers are supervised; a worker that dies is recorded
   (`job.failed` with `reason = WORKER_LOST`), the job is retried up to `max_retries` if
   `idempotent`, and the pool is replenished. Two consecutive worker losses for the same job
   type trip a circuit breaker that disables that job type and tells the user why — this is
   how we survive a codec that segfaults FFmpeg on a specific machine without shipping a
   broken editor.

6. **Job records persist** to `ai_jobs` / `export_jobs` (state, timestamps, params hash,
   error, artefact paths) so history, retry and post-crash reporting are possible. On
   startup, jobs in `RUNNING` state are reconciled to `INTERRUPTED` and surfaced in the UI.

7. **The UI never polls job state.** All job UI is event-driven. Polling endpoints exist for
   resync only.

8. **Resource governance.** Concurrency caps derive from detected capability:
   `cpu_workers = max(1, physical_cores - 1)` (one core reserved for UI/preview),
   `gpu_workers = 1` unless multiple GPU contexts are proven safe, `io_workers` capped
   separately. Caps are user-overridable in Settings ▸ Performance and are recorded in
   telemetry so a support engineer can see them.

## Consequences

**Positive**

* The UI stays responsive under heavy load; a background ASR cannot stall scrubbing.
* Cancellation and progress work uniformly for export, AI, proxies and caches.
* A crashing codec or model takes down one worker, not the editor.
* Job history and interruption recovery come from persistence, not from ad-hoc code.

**Negative / accepted**

* Process jobs pay pickling costs; avoided for small work by declaring `THREAD`.
* Two pools plus supervision is more machinery than a bare `ThreadPoolExecutor`. Accepted —
  this machinery is what "background rendering" and "background AI" actually require.
* Windows `spawn` semantics mean process jobs must re-import and re-initialise (model
  reload!). Mitigated by a persistent worker with a warm model cache and by routing ASR to a
  dedicated long-lived worker process rather than the general pool.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Threads only | GIL starvation: CPU-bound compositing/ASR blocks the UI |
| Processes only | Pickling and startup cost is absurd for a 64×64 thumbnail |
| `asyncio` tasks only | Does not solve CPU parallelism at all; still used *inside* the service for I/O concurrency |
| Celery / RQ / Dramatiq | Require a broker; a desktop app must not depend on Redis |
| Ad-hoc `threading.Thread` per feature | No priority, no cancellation, no persistence, no supervision — the actual source of most "editor froze" bugs |
| Killing running jobs on preemption | Corrupts outputs and wastes work; admission control is strictly better |
