"""L3 feature — render: the recipe for a frame, and how big to draw it.

**Purpose.** Own the three decisions that stand between a project and a picture:
**what one composed frame is made of** (the frame plan), **how big to draw it**
(the preview plan), and **what the composed frame looks like** (the compositor
and the effect kernels). `domain/` owns what a clip, an effect, a grade and a
transition *are*; `ports/render.py` owns where composed frames *go*;
`ports/imaging.py` owns the six pixel primitives a compositor borrows. This
feature owns the sheet of paper that all of them read from.

The frame plan also completes the one thing `Timeline.resolve` cannot: a
transition is a recipe for *two* pictures, but the domain hangs it off one clip
and only reports clips that contain the frame. For every mix, the planner finds
the clip on the other side of the cut — which for a centred dissolve is on
screen during the *first* half, when the transition's owner is not — and plans
both, outgoing below incoming, each carrying the same `TransitionMix`.

**Folder structure.**

```
services/render/
├── __init__.py   this file: the feature's contract
├── frames.py     FramePlan / LayerPlan / DecodeRequest — the compositing recipe
├── preview.py    Viewport · fit_scale · preview_size · warm_frames · PreviewPlan
├── kernels.py    the arithmetic behind the effect catalogue, and its registry
├── composite.py  composite_frame · apply_grade — the plan, turned into pixels
├── pool.py       FrameSourcePool — decode requests, served with bounded seeks
├── loop.py       render_frames · render_preview_frame — one loop, any sink
└── export.py     ExportVideoJob — that loop, as a cancellable job
```

`composite.py` and `kernels.py` are split the way a specification and an
implementation are split. A **spec** (`services/effects`) says an effect has a
name, a type and parameters, and is what the UI builds a panel from; a **kernel**
(`kernels.py`) is the function that turns those parameters into pixels. A spec
with no kernel is inert, not broken: the frame renders without it (ADR-0015
rule 3), which is exactly what must happen when a plugin's effect is named by a
project on a machine where the plugin is not installed.

**Backend / frontend.** One API per intent. The preview panel calls
`plan_preview(...)` and gets the size, the scale, the letterbox offset and the
frames to warm; a single frame on screen is one `render_preview_frame(...)`; an
export is one `render_frames(project, frames, pool=..., ops=..., sink=...)`.
Preview and export differ *only* in the sink — a JPEG sink and an encoder sink
are the same `FrameSink` — which is what keeps the preview panel and the export
engine from drifting apart.

**State management.** Everything on the planning side is a frozen value: a
`FramePlan` can be cached, handed to a worker process or compared in a test, and
`plan_frames` is a generator, because an export plans a hundred thousand frames
and must not hold them all. Two pieces are stateful, and both are explicitly
owned and explicitly bounded: `FrameSourcePool` holds a few open decoders and a
byte-budgeted picture cache, and both are released by `close()` — a pool is a
context manager because a render that forgets to close one leaks a file handle
per asset.

**Functions.**

| Call | Answers |
| --- | --- |
| `plan_frame(project, frame, sources)` | "what is this frame made of" |
| `plan_frames(project, frames, sources)` | the same, lazily, for a range |
| `FramePlan.decodes()` | "which pictures do I need, deduplicated" |
| `fit_scale(w, h, viewport)` | "how big can this be drawn" |
| `preview_size(w, h, viewport, zoom)` | "what size do I composite at" |
| `warm_frames(playhead, count, last_frame)` | "what should already be decoded" |
| `plan_preview(...)` | all of the above, for one frame |
| `composite_frame(plan, pictures, *, ops, ...)` | "what does this frame look like" |
| `apply_grade(sample, buffer, *, luts)` | the same, for one picture and one grade |
| `apply_chain(chain, buffer, *, registry, ops, frame)` | one effect stack, one picture |
| `builtin_kernels()` / `kernel_types()` | which effect arithmetic exists |
| `FrameSourcePool.pictures(requests)` | "give me these pictures" |
| `FrameSourcePool.prefetch(requests)` | the same, warmed ahead of being asked |
| `render_frames(project, frames, *, pool, ops, sink, ...)` | a range, into a sink |
| `render_preview_frame(project, frame, *, pool, ops, ...)` | one frame, in hand |

**Dependency injection.** The compositor takes its collaborators as arguments
rather than importing them: `ops` (`ports/imaging.ImageOps`) is required,
`kernels` defaults to the built-in registry, and `luts` is needed only by a
grade that carries a LUT. Nothing in this feature imports OpenCV, opens a LUT
file or reaches into `infra`; the composition root binds them. That inversion is
what makes a render testable on a machine with no FFmpeg and movable to a GPU.

**Events.** None yet. A render is a `Job` (ADR-0010) and reports `job.*`; the
preview publishes nothing, because it is a loop the UI drives rather than a task
the scheduler owns.

**Error handling.** Both planners are total over *frames*: a frame past the end
of a timeline plans as empty, because a render runs past the end by design. They
raise `NovaInvariantError` for a nonsensical argument — a negative frame, a
zero-sized viewport, a non-positive zoom — because those are bugs in the caller,
not states of a project. Encoding failures are `ports/render.py`'s codes
(`NS-RENDER-4001` unwritable, `NS-MEDIA-4002` no encoder, `-4003` encode failed,
`-4004` unsupported spec, `-4005` cancelled), not this feature's.

**Caching.** Two caches, at two levels, for two different reasons.

`DecodeRequest.key` is `(asset_id, source_frame, source)`, so nothing keys on a
frame number that means something different after an edit. `warm_frames` is
forward-only because work behind the playhead is the one kind certain to be
wasted.

The pool caches *decoded pictures*, bounded in bytes rather than in entries — a
4K frame is thirty times a 720p one, and a cache of "64 frames" is either a
rounding error or a third of the machine. Its real work is avoiding **seeks**:
decoding frame *n* on its own can cost a whole GOP, so each stream keeps a live
forward read and a render that walks forwards pays one seek per clip per run
instead of one per frame. `clear_cache()` is what an edit calls — the pictures
on screen are of a timeline that no longer exists — and it keeps the decoders.

The loop caches nothing. A cache inside it would be a second opinion about what
a frame is, and the caller (the preview panel, or the job) is the only thing
that knows what is worth keeping.

**Performance.** `plan_frame` is O(layers at this frame) — one `resolve` plus a
few tuple lookups — and pure, so a renderer can plan a frame while the previous
one composites. `decodes()` deduplicates, so a split clip left in place costs
one read and not two. Neutral grades and empty chains are dropped at plan time
rather than tested per frame.

The composite is one `warpAffine` per layer and one float round trip per effect
chain, and a neutral grade costs nothing at all. The number to watch is the
pool's `seeks`: a sequential render of one clip reports **one**, and a report of
one per frame means something is visiting frames out of order. Thirty frames of
one clip costing thirty seeks produces perfectly correct pictures and takes
thirty times as long, which is the bug this design exists to prevent and the
only way to catch it is to count.

**Testing.** `tests/services/test_render_frames.py` pins the recipe: layer order,
per-layer effect and grade ordering, that generated clips ask for no decode,
that duplicate reads collapse, that an empty frame plans as empty, and that a
transition plans both its pictures in the right order — including the centred
dissolve's first half, which the domain alone does not surface.
`tests/services/test_render_preview.py` pins the geometry: contain-not-cover,
the native cap, even dimensions, centred bars, and forward-only warm-up.
`tests/services/test_render_composite.py` pins the pixels: geometry and the
anchor, layer order, that half-transparent white over black is 128, that a dip
and a dissolve differ only by `fill`, that every effect in the catalogue has a
kernel and a missing one is skipped, and that one frame twice is byte-identical.
`tests/services/test_render_pool.py` counts seeks against a decoder that can be
asked how many it made, and `tests/services/test_render_loop.py` drives the loop
into a fake sink to pin where an empty frame, a gap, a cancellation and an
encoder failure each land. `tests/services/test_render_preview.py` and
`test_preview_renderer.py` cover the panel's half, and
`tests/services/test_render_export.py` covers the job: staged progress, resume
points, a cancellation that leaves no file, an offline asset that does not stop
the export, and — in the one test that touches FFmpeg — a clip exported through
the real encoder and opened again. `tests/infra/test_imaging.py` pins the
imaging port's adapter against a second, plain-NumPy implementation. No FFmpeg,
no clock.

**The export job.** `export.py` is the loop's other caller, and the differences
are the point: it runs in the process pool (ADR-0010 §1), it is data rather than
a closure so that Windows `spawn` can pickle it, it builds its decoders and its
renderer *inside* the worker from injected factories, and it reports through the
job port rather than to a caller. What it does not do is know that: a job body
takes a `JobContext` and returns a `Result[JobOutcome]`, which is why a test can
run a whole export by calling it directly.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **Cost estimation.** Whether a frame fits a real-time budget needs the effect
  *catalogue*, which belongs to `services/effects` — a feature this one may not
  import. It belongs in `services/shared` when that lands, and it is what a
  draft-quality preview mode will read.
* **Blend modes and masks**, which the domain already models and the compositor
  does not yet apply: they slot into one step of one function (§7.12).
* **A GPU imaging adapter**, which implements the same six methods of
  `ports/imaging.py` and is bound at composition time — no renderer changes
  (ADR-0012 §2).
* **Audio**, which resolves the same timeline into a sample graph rather than a
  layer stack (§7.4).
"""

from __future__ import annotations

from nova_studio.services.render.composite import apply_grade, composite_frame
from nova_studio.services.render.export import (
    EXPORT_CACHE_BYTES,
    EXPORT_JOB_KIND,
    ExportRequest,
    ExportVideoJob,
    export_job_spec,
    export_params_hash,
    export_summary,
)
from nova_studio.services.render.frames import (
    DECODE_FROM_ORIGINAL,
    DecodeRequest,
    FramePlan,
    LayerPlan,
    plan_frame,
    plan_frames,
)
from nova_studio.services.render.kernels import (
    KernelRegistry,
    apply_chain,
    builtin_kernels,
    kernel_types,
)
from nova_studio.services.render.loop import RenderOutcome, render_frames, render_preview_frame
from nova_studio.services.render.pool import (
    DEFAULT_CACHE_BYTES,
    DEFAULT_OPEN_SOURCES,
    FrameSourcePool,
    PoolStats,
    SourceResolver,
)
from nova_studio.services.render.preview import (
    DEFAULT_WARM_COUNT,
    PreviewFrame,
    PreviewPlan,
    PreviewRenderer,
    Viewport,
    fit_scale,
    plan_preview,
    preview_size,
    resolve_asset,
    warm_frames,
)

__all__ = [
    "DECODE_FROM_ORIGINAL",
    "DEFAULT_CACHE_BYTES",
    "DEFAULT_OPEN_SOURCES",
    "DEFAULT_WARM_COUNT",
    "EXPORT_CACHE_BYTES",
    "EXPORT_JOB_KIND",
    "DecodeRequest",
    "ExportRequest",
    "ExportVideoJob",
    "FramePlan",
    "FrameSourcePool",
    "KernelRegistry",
    "LayerPlan",
    "PoolStats",
    "PreviewFrame",
    "PreviewPlan",
    "PreviewRenderer",
    "RenderOutcome",
    "SourceResolver",
    "Viewport",
    "apply_chain",
    "apply_grade",
    "builtin_kernels",
    "composite_frame",
    "export_job_spec",
    "export_params_hash",
    "export_summary",
    "fit_scale",
    "kernel_types",
    "plan_frame",
    "plan_frames",
    "plan_preview",
    "preview_size",
    "render_frames",
    "render_preview_frame",
    "resolve_asset",
    "warm_frames",
]
