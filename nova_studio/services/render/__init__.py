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
├── composite.py  composite_frame · apply_grade — the plan, turned into pixels
└── kernels.py    the arithmetic behind the effect catalogue, and its registry
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
frames to warm; the renderer calls `plan_frame(project, frame, sources=...)` per
frame. Neither ever looks inside a `Project` to find out what a clip is wearing,
and neither ever guesses a size — which is what keeps the preview panel and the
export engine from drifting apart.

**State management.** Everything here is a frozen value. A `FramePlan` can be
cached, handed to a worker process or compared in a test; none of it carries a
decoder, a clock or a handle. `plan_frames` is a generator, because an export
plans a hundred thousand frames and must not hold them all.

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

**Caching.** The plan *is* the cache design. `DecodeRequest.key` is
`(asset_id, source_frame, source)`, so a preview cache keys on exactly what it
decoded and not on a frame number that means something different after an edit;
`warm_frames` is forward-only because work behind the playhead is the one kind
certain to be wasted.

**Performance.** `plan_frame` is O(layers at this frame) — one `resolve` plus a
few tuple lookups — and pure, so a renderer can plan a frame while the previous
one composites. `decodes()` deduplicates, so a split clip left in place costs
one read and not two. Neutral grades and empty chains are dropped at plan time
rather than tested per frame.

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
`tests/infra/test_imaging.py` pins the imaging port's adapter against a second,
plain-NumPy implementation. No FFmpeg, no clock.

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
from nova_studio.services.render.preview import (
    DEFAULT_WARM_COUNT,
    PreviewPlan,
    Viewport,
    fit_scale,
    plan_preview,
    preview_size,
    warm_frames,
)

__all__ = [
    "DECODE_FROM_ORIGINAL",
    "DEFAULT_WARM_COUNT",
    "DecodeRequest",
    "FramePlan",
    "KernelRegistry",
    "LayerPlan",
    "PreviewPlan",
    "Viewport",
    "apply_chain",
    "apply_grade",
    "builtin_kernels",
    "composite_frame",
    "fit_scale",
    "kernel_types",
    "plan_frame",
    "plan_frames",
    "plan_preview",
    "preview_size",
    "warm_frames",
]
