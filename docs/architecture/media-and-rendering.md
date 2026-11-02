# §7 — Media & rendering architecture

**Part of:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · **Owner:** Architecture Group
**Last reviewed:** 2026-11-02

This file is section 7 of the system architecture, kept separate because the
section outgrew the 64 KiB single-file budget (`scripts/check_repo_hygiene.py`)
and will keep growing as the render and caption engines are built. Section
numbers are unchanged, so a reference to "ARCHITECTURE §7.10" resolves here.

---

## 7. Media & rendering architecture

### 7.1 Toolchain discovery

`infra/media/ffmpeg.py` resolves a toolchain in strict priority order and records the
decision:

1. `NOVA_FFMPEG` env var (explicit override),
2. bundled binary shipped inside the portable EXE (`apps/desktop/resources/bin/`),
3. `imageio-ffmpeg` static binary (guaranteed present, FFmpeg 7.0),
4. system `ffmpeg` on `PATH`,
5. **PyAV's linked libraries only** — no CLI; used when everything above is absent.

Every decode/encode path has both a **PyAV implementation** (in-process, zero-copy-ish,
needed for frame-accurate compositing) and a **CLI implementation** (needed for filters that
only exist in `libavfilter` graphs, and for multi-pass export). The `MediaBackend` port
abstracts the choice; a probe cache means the discovery runs once per session.

### 7.2 Frame pipeline

```
Clip(source, in, out, speed) ─┐
Clip ─────────────────────────┤   TimelineResolver
Clip ─────────────────────────┘        │  resolves time t → ordered list of
                                       ▼  visible contributions
                             ┌──────────────────────┐
                             │  FrameSourcePool     │  per-asset decoders, LRU,
                             │  (PyAV DemuxCache)   │  keyframe-index aware
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  DecodeStage         │  seek(to keyframe ≤ t) then
                             │                      │  step to exact frame (verified
                             │                      │  necessary: GOP=30 seek lands
                             │                      │  up to 1 s early)
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  SpeedStage          │  constant + ramped (curve)
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  EffectChain         │  ordered EffectOps (NumPy/OpenCV)
                             └──────────┬───────────┘   GPU path optional
                                        ▼
                             ┌──────────────────────┐
                             │  TransformStage      │  position/scale/rotate/crop/anchor
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  Compositor          │  painter's algorithm bottom→top,
                             │                      │  blend modes, opacity, masks
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  TransitionStage     │  A/B overlap window resolution
                             └──────────┬───────────┘
                                        ▼
                             ┌──────────────────────┐
                             │  OverlayStage        │  text, captions, motion graphics
                             └──────────┬───────────┘   (RGBA, SDF text, animation eval)
                                        ▼
                             ┌──────────────────────┐
                             │  ColourStage         │  LUT / curves / wheels, applied once
                             └──────────┬───────────┘   at the end for correctness
                                        ▼
                                 FrameBuffer (rgb24 / rgba)
                                        │
                        ┌───────────────┴────────────────┐
                        ▼                                ▼
                 PreviewSink                      ExportSink
                 (JPEG/WebP over HTTP,            (PyAV/CLI encoder,
                  or shared-mem in desktop)        audio muxed separately)
```

Design invariants:

* **Frame-accurate by construction.** Time is represented as integer frame numbers at a
  project timebase; `Timecode` converts to/from seconds only at the edges. Floats never
  accumulate across the timeline (ADR-0006).
* **Proxies are transparent.** A clip references an asset; the asset resolves to
  `original | proxy | thumbnail` by a `ProxyPolicy` decided from the preview scale factor.
  Nothing downstream knows which it decoded.
* **The compositor is pure.** Given `(timeline, t, resolution)` it returns a frame and
  mutates nothing. This is what makes the preview cache, the export, the thumbnail service
  and the test-suite all use the *same* code path — the classic NLE bug class "preview looks
  different from export" is structurally impossible.
* **Colour stage runs last** so grading applies to the composited result (matching Resolve's
  node graph semantics) unless a per-clip grade is explicitly requested.

### 7.3 GPU strategy

GPU is an *acceleration*, never a *requirement*. `ports/gpu.py` defines `GpuBackend` with
capability probes; adapters: `NullGpu` (default, CPU/NumPy+OpenCV), `CudaBackend`
(NPP/nvcodec when `av` reports `h264_cuvid`/`hevc_cuvid`), `OpenCLBackend`, and
`WebGLOverlay` for the frontend-side preview compositor. Each declares supported ops; the
`EffectChain` planner partitions ops between GPU and CPU and falls back per-op, not
per-frame. Capability is detected once and cached in `settings`.

### 7.4 Audio

Audio is **not** composited per video frame. The `AudioEngine` resolves the same timeline
into an independent sample graph, mixes at the project audio rate in float32, applies
per-clip gain/fade/EQ/compression, then a master chain (EQ → compressor → limiter →
normalise target LUFS). Preview streams a rolling window; export writes a WAV stem that is
muxed by the export pipeline. Beat/silence detection run as IDLE jobs and cache results in
`audio_analysis`.

### 7.5 The media record and the media port

Two L2 modules carry everything that is true about footage before a single packet is
decoded. They are the seam the whole frame pipeline in §7.2 reads through.

**`domain/media.py` — what footage *is*, with no I/O at all:**

| Object | Role |
| --- | --- |
| `ColourSpace` / `ColourRange` / `ColourPrimaries` / `ColourTransfer` | Container colour signalling, values read back from the bundled FFmpeg 7.0.2 (§7.6) |
| `ColourMeta`, `FrameBuffer` | The four tags every frame carries, and the pixels they describe (ADR-0007 §6) |
| `ContentHash` | Identity of a file's bytes, algorithm travelling with the digest |
| `VideoStreamInfo` / `AudioStreamInfo` | Per-stream geometry, rate, codec, colour, SAR/rotation |
| `MediaInfo` | The probe summary — the only part of a probe that is persisted |
| `AudioBuffer` | Decoded audio: float32, `(n_samples, n_channels)`, nominal ±1.0 |
| `MediaAsset` | The project's reference: `asset_id`, path, kind, hash, link state, probe |
| `NDArray` | The one third-party type allowed in port signatures, re-exported so frames have a single home (ADR-0002 rule 2) |

State changes on `MediaAsset` are methods, not attribute assignment, because two fields are
coupled: a content hash and a probe summary describe the same bytes, so a relink that cannot
prove the content is unchanged discards both. This is what makes "the path moved but the
probe says 1920×1080" a provable statement rather than a hope (ADR-0015 rule 3).

**`ports/media.py` — how footage is read, without naming a library:**

| Protocol | Lifetime | Answers |
| --- | --- | --- |
| `MediaProber` | stateless, shared | "what does this file say about itself" |
| `MediaDecoder` | one per process | "open me a handle" |
| `DecodedMedia` | one per asset, pooled | "give me stream N" |
| `VideoFrameSource` / `AudioSampleSource` | one per open stream | frames, or blocks of samples |
| `AudioResampler` | one per mixer | rate and channel conversion |

Contract rules an adapter must honour:

1. **Entry points return `Result`.** `probe()` and `open()` answer I/O failure with `Err`
   carrying a `MediaErrorCode` (`NS-MEDIA-4001` unreadable, `-4003` unsupported; `-4002`
   belongs to the render port's missing-encoder case, per ADR-0007 §7).
2. **A failure *during* reading is latched, not raised.** An `Iterator[FrameBuffer]` has no
   `Result` channel, and allocating one `Result` per frame buys nothing on a 60 fps path; the
   source latches the error and the consumer reads `last_error()` once after the loop.
   `frame_at()` returning `None` means "no frame"; `last_error()` says whether that was the
   end of the stream or damage.
3. **Positions are integers** — frames for video, samples for audio (ADR-0006). No method
   takes seconds.
4. **Sequencing is the fast path.** `frame_at()` may cost a whole GOP; `keyframe_indices()`
   tells a scrubber where the cheap landing spots are and may be empty when the container
   exposes no index — never fabricated.
5. **Handles are closed**, idempotently: a pooled handle may be closed by the pool and by a
   `finally` in the same stack.
6. **No third-party types.** Frames are `FrameBuffer`, audio is `AudioBuffer`, both from
   `domain`.

*Still to build:* `infra/media/pyav/` and `infra/media/cli/` (the two adapters), the
`FrameSourcePool` that owns handle lifetimes, and
`tests/media/test_backend_conformance.py`, which runs both backends over the same generated
assets and asserts identical output metadata (ADR-0007).

### 7.6 Colour truth

Every frame carries `(space, range, primaries, transfer)` — ADR-0007 §6 — and the enum
values are **measured, not recalled**. On 2026-09-24 they were read back from the bundled
FFmpeg 7.0.2 two ways: libavutil's `av_color_*_name` tables via `ctypes` on the PyAV wheel's
`libavutil`, and an encode/decode round-trip through libx264. Key values:

* space: `1 bt709`, `5 bt470bg`, `6 smpte170m`, `9 bt2020nc`, `10 bt2020c`, `14 ictcp`
* primaries: `9 bt2020`, `22 ebu3213`
* transfer: `16 smpte2084` (PQ/HDR10), `18 arib-std-b67` (HLG)
* range: `0 unspecified`, `1 limited` (ffprobe prints `tv`), `2 full` (ffprobe prints `pc`)

**Known divergence, pinned by a test:** PyAV 18.1's `Colorspace.SMPTE170M` is `5`, which is
`bt470bg` in FFmpeg — `smpte170m` is `6`. An encode/decode round-trip proves FFmpeg's
numbering, and the domain follows FFmpeg. `tests/media/test_av_colour_contract.py` pins
PyAV's values *as shipped*, so a library fix flips the test instead of silently changing the
look of every SD clip.

Rules that follow: never trust a binding's alias over the measured toolchain; conversions
happen explicitly at the compositor boundary, never implicitly in `swscale`; and an
unspecified tag means "choose a defined default", not "a distinct colourspace".

### 7.7 The render port and the export vocabulary

`ports/render.py` is where composed frames leave the process. Four protocols:

| Protocol | Lifetime | Answers |
| --- | --- | --- |
| `FrameSink` / `AudioSink` | one stream of one export | "here is a frame / a block of samples" |
| `RenderTarget` | one export | "a muxed output: video + optional audio, one finish" |
| `Renderer` | one per process | "open me a target for this spec and path" |
| `CapabilityProbe` | one per session, cached | "what can this machine actually encode" |

`domain/export.py` holds what the port moves: `OutputSpec` (container + video +
optional audio + faststart), `VideoEncodeSpec`, `AudioEncodeSpec`, `RateControl`,
`RenderStats`, and `ToolchainCapabilities`. Every one has a canonical JSON form,
because export presets are stored in `templates/` and export history is listed.

The encoder names in that module were **measured**, not recalled, from the bundled
FFmpeg 7.0.2 static build (imageio-ffmpeg 0.6.0) on 2026-09-25, and
`tests/media/test_encoder_contract.py` re-checks them against the real binary:

* video: `libx264`, `libx265`, `libvpx-vp9`, `libaom-av1`, `prores_ks`, `mpeg4`, `dnxhd`
* audio: `aac`, `libmp3lame`, `libopus`, `flac`, `pcm_s16le`, `libvorbis`, `ac3`
* containers: `mp4`, `mov`, `matroska`, `webm`, `wav`, `mp3`, `mxf`
* pixel formats: `yuv420p`, `yuv422p`, `yuv444p`, `yuv420p10le`, `yuv422p10le`,
  `yuv444p10le`, `nv12`, `p010le`, `rgb24`, `rgba`, `gbrp`, `gray`

The same probe reports **one** hardware acceleration method on this machine
(`vdpau`) and none of the hardware encoders we know the names of — which is the
whole argument for `CapabilityProbe` and for ADR-0012 §6: capability is detected
once, cached, and re-probed only on explicit user action.

Contract rules the port makes mechanical:

1. **A render that cannot succeed fails at `open`, before frame one** —
   `NS-MEDIA-4002` (ADR-0007 §7) with the remedy
   `ToolchainCapabilities.describe_missing` wrote ("this build has no libx265
   encoder"), never a failure at minute forty.
2. **`finish` is the only point at which the file is valid** — index written,
   duration known, faststart applied. Encoder delay frames are flushed there, so
   a render that stops after the last `write` does not lose the tail.
3. **`abort` removes the partial output.** A half-written file that plays for
   nine seconds is worse than no file, because it looks like success.
4. **Cancellation is a value** — `Err(NS-RENDER-4005)` — so the UI can say
   "stopped" rather than "failed".
5. **Progress is the job's business, not the sink's.** The sink counts;
   `RenderStats` is its answer at the end.

*Still to build:* `infra/render/pyav_encoder.py` and `infra/render/cli_encoder.py`
(the two adapters), the `ExportSink` wiring in §7.2, and
`tests/render/test_gpu_cpu_parity.py` for ADR-0012 §5. The GPU half itself gets its
own port — `ports/gpu.py`, `GpuBackend` with `supports/allocate/execute/release` —
because a compute device has a different lifetime from an encoder.

### 7.8 The edit decision list (`domain/timeline.py`)

What the frame pipeline resolves. `Timeline` → `Track` → `Clip` → source frames,
plus `Transition` at a clip's edge and `Marker` on the ruler.

Decision | Why
--- | ---
**Time is integer frames**, never seconds (ADR-0006) | A clip's duration is derived once from its source length and its exact rational `speed`, then stored as a whole number. Two clips at "half speed" cannot drift apart, because nothing is accumulated as a float.
**Source time and timeline time are separate spaces** | `start_frame` is a timeline coordinate, `in_frame`/`out_frame` are source coordinates (`out` exclusive, as containers count), and `source_frame_at()` is the only thing that crosses between them. Trimming one end therefore cannot move the other.
**Tracks are stored top-first, rendered bottom-first** | `tracks[0]` is the topmost track, because that is how an editor displays and names them; `resolve(frame)` returns contributions in painter's-algorithm order, so the last entry is drawn last. Storing in one order and painting in the other is the classic inverted-layer bug, so both are stated and both are tested.
**An overlap is legal only under a transition** | Two clips sharing frames with no transition between them would be resolved arbitrarily by the renderer — a different picture tomorrow than today. `validate_timeline()` names the overlap and the project is not saved in that state.
**Transitions hang off a clip edge, not a clip pair** | Deleting a clip takes its transitions with it, and trimming an end drags its transition's cut along — which is what editors do.
**Snapping targets the timeline's own geometry** | `snap_candidates()` offers the start, the end, every clip edge and every marker within a tolerance, nearest first, and never the dragged clip's own edges. No grid the user did not ask for.

`resolve(frame)` is what makes the compositor a pure function of
`(timeline, frame)` — the structural reason "preview looks different from export"
cannot happen here. It skips disabled clips and hidden tracks; a *muted* track
still shows its pictures, because muting is a mix decision the audio stage owns.

**Baking a transition is a pure function of `(kind, progress)`** |
`bake_transition` returns a `TransitionMix` — A's opacity, B's opacity, what
fills the frame where neither shows, and each side's offset and scale — so the
compositor applies numbers without knowing which transition produced them. A
plugin contributes a new kind by contributing an evaluator, not a code path in
the renderer (ADR-0009 §6's principle). The dissolve family is *linear*: the
compositor blends in the working colour space (ADR-0012), so a perceptually even
dissolve is its business, not the edit's. A dip is the one case where `fill`
matters — dip-to-black and dip-to-white are the same two weights with a
different fill. Push and slide are the same geometry and say so: with B drawn
over A, they are the same picture.

Deliberately not here: **mutation policy**. Moving, trimming, rippling and
slipping are `Command`s in `services` (ADR-0008) composed from the `with_*`
builders; effects and grades are a chain on a clip (`domain/effects.py`); and
which file a clip decodes — original, proxy or thumbnail — is a media-layer
policy, not an edit decision.

### 7.9 The effect and animation model
(`domain/animation.py`, `domain/effects.py`)

The other half of the frame pipeline: what a clip *looks like*. Every NLE has
converged on the same shape — a parameter is a value over time, an effect is a
bag of parameters plus a mix, a chain is an ordered stack — so this module
implements that shape rather than inventing one.

The model is **two files, not one**. `animation.py` owns the value over time —
`Interpolation`, `ease`, `bezier_progress`, `Keyframe`, `Animatable`,
`interpolate` — and `effects.py` owns what the values *mean*: `ParameterSpec`,
`EffectSpec`, `Effect`, `EffectChain`, `Transform`, `Mask`. The split is not
cosmetic. ADR-0009 §7 requires the caption baker to emit the editor's own
keyframes, so captions, transforms and effects all animate through the same
`Animatable`, and that shared object cannot live inside any one of its three
customers. It also keeps each file inside the 64 KiB module cap
(`scripts/check_repo_hygiene.py`) without splitting an object across files.

Decision | Why
--- | ---
**A parameter is one type, animated or not** | `Animatable` holds a value and an optional keyframe list. Adding the first keyframe promotes a constant without changing its type, so no reader needs two branches for what the user thinks of as one slider.
**Keyframes sit on integer frames** | Interpolation is derived from two integer positions, never accumulated (ADR-0006). The value at frame 720 is identical in the preview, the export and the test suite, at 24 fps and at 60 fps.
**The left keyframe owns the segment's curve** | Its `interpolation` and `out_handle` decide the shape; the right keyframe contributes only its `in_handle`. Deleting a keyframe therefore changes the easing of the segment *before* it — the rule every editor follows and every from-scratch implementation gets backwards.
**Bezier handles may overshoot in y but not in x** | `y` outside 0-1 is the bounce a user is asking for; `x` outside it would stop the curve being a function of time. `x` is inverted by Newton-Raphson with a bisection fallback, both bounded, so the solve is deterministic; the cubic-bezier(0.25, 0.1, 0.25, 1.0) reference values are pinned by tests.
**Plugins publish a spec, not a subclass** | `EffectSpec` + `ParameterSpec` describe a type, its parameters, their ranges, units and whether a stopwatch is offered. A third-party effect is therefore indistinguishable from a built-in one, and the inspector panel is generated (ADR-0011).
**Effects carry a cost hint** | `EffectCost` lets preview drop expensive effects before it drops frame rate. Export never does; a wrong guess costs a slower preview, not a wrong picture.
**Transform is a value object, not an effect** | Every clip has one, and its coordinates are composition pixels from the centre — never preview pixels — so a layer 100 px right of centre means the same thing in the 960×540 preview and the 3840×2160 export.
**Masks are fractions of the layer** | Bounds survive a resolution change and a proxy swap; a `PATH` mask keeps its points and is never interpolated here, because freehand shape animation belongs to the shape system.

`validate_effect` / `validate_chain` check an instance against its spec on
load — arity, range, choice membership, animatability — so a malformed plugin
payload is reported when the project opens rather than as a black frame an hour
into a render. An effect whose *spec* is not installed is skipped, not
rejected: a project with an uninstalled plugin must still open.

`Animatable` deliberately does not carry the parameter's *kind*. Whether a
number is a percentage, an angle or a colour is declared once by the
`ParameterSpec` that owns the name; storing it again on every value would give
the same fact two homes that can disagree.

Deliberately not here: **pixels**. Nothing in either module touches a frame
buffer; `infra/render` does the arithmetic on CPU or GPU (ADR-0012), which is
why these files import no NumPy. Also not here: the effect *registry* (a
services catalogue built from installed plugins) and *ownership* — a chain does
not know whether it decorates a clip, a track or the output.

### 7.10 The project aggregate root (`domain/project.py`)

Every module below this one describes a *piece* of a project. This one owns them
all, and therefore answers the question none of them can answer alone: **is this
project consistent?** A clip naming an asset the bin does not hold, an effect
bound to a clip that was deleted, a caption filed under a name that would escape
the archive — none is visible from inside one module (ADR-0004 §3, ADR-0015
rule 1).

Decision | Why
--- | ---
**A damaged project still opens** | Construction refuses only what a construction can see — duplicate ids, an empty name. `validate_project` *reports* the rest as one sentence. An editor that refuses to open a broken project is an editor that loses work (ADR-0015 rule 3).
**Missing media is a state, not an error** | `missing_assets()` lists what is not where the project says; `relink_asset` repairs it. Clips reference the asset *id*, never the path, so a moved folder is one operation rather than a hundred edits.
**Bindings, not fields** | Effects, transforms, masks, blends and grades live here keyed by the id of the clip or track they decorate, not on `Clip`. A chain does not know what it is attached to, which is what lets one type serve a clip, a track and the output grade — and what makes "delete this clip" a single pruning pass in `with_timeline`.
**One timebase, one source of truth** | `Project.timebase` reads it from the timeline and never stores a second copy that could disagree with the edit it describes. The container may repeat it in `project.json` for a support engineer; the model has exactly one.
**Untouched things are not stored** | An empty chain, an identity transform, an empty mask list, a `NORMAL` blend and a neutral grade each *remove* their binding. A project the user has never decorated carries no bindings at all, and a project whose effects were all deleted is indistinguishable from one that never had any.
**Only the first problem is reported** | A user fixes one thing at a time; a wall of text helps nobody. Checks run in the order a user would hit them: the edit's own structure, then clip→asset, then each binding family (effects, transforms, masks, blends, grades), then the captions.
**Timestamps are injected** | `created_ms` and `modified_ms` are passed in, never read from a clock, so a save is reproducible to the millisecond in a test (ADR-0002 rule 1). `touched` refuses to move a save backwards.
**Caption ids are validated where they are accepted** | A `.nova` file is a ZIP, so a crafted document id is the zip-slip attack. `CaptionDocumentRef` checks the id against `is_valid_document_name` — the rule belongs at the door, not at the writer.
**The container split is tested here** | `to_documents()` / `from_documents()` lift the timeline and each caption document into their own entries, so `infra/persistence` maps entries to bytes and never invents the layout.
**Settings are few, and checked** | Channel count is one of {1, 2, 6, 8}; `FrameSize.is_even` exists because every 4:2:0 encoder we ship needs even dimensions, and it is better to be able to ask than to fail an hour into an export.

Bindings, all frozen and all keyed by what they decorate:

| Binding | Key | Removed when |
| --- | --- | --- |
| `EffectBinding` | `(target, owner_id)` | the chain is empty |
| `TransformBinding` | `clip_id` | the transform is static *and* the identity at frame 0 |
| `MaskBinding` | `clip_id` | the mask tuple is empty |
| `BlendBinding` | `(target, owner_id)` | the mode is `NORMAL` |
| `GradeBinding` | `(target, owner_id)` | the grade is neutral |

`Project` is immutable: every edit is a `with_*` call returning a new project,
which is what makes a command's undo a stored previous value rather than an
inverse operation that can drift (ADR-0008). Deliberately not here: **I/O** (no
path, no file, no clock), **undo** (this module offers the builders the commands
compose), and **autosave and export** (`domain/persistence` owns the checkpoint
policy, `domain/export` owns the output spec).

### 7.11 Colour grading (`domain/grade.py`)

The last thing that happens to a frame, and the first thing a client comments
on. It lives in its own module rather than in `effects.py` because grading is
not an effect: it has no chain, no mix and no order — it is one set of
corrections the compositor applies after a picture is assembled, and the
renderer compiles it into a single 3-D texture rather than a stack of passes.

Decision | Why
--- | ---
**Every correction is animatable** | Exposure ridden across a shot as the sun goes behind a cloud is the same object as exposure set once: an `Animatable`, exactly like an effect parameter or a transform. One keyframe pins a value, so an unanimated grade is still one type.
**Every correction is 0-neutral** | A model where three sliders are 0-neutral and two are 1-neutral is a model where a default gets pasted into the wrong field at 2 a.m. The one exception is `lut_strength`, which is a proportion and so is naturally 0-1.
**Curves are monotone cubic (Fritsch–Carlson)** | A plain Catmull-Rom spline can bend past a control point, which on a tone curve reads as a band of inverted contrast exactly where the user was being careful. A user drags curves in *shapes*; the shape they see must be the shape they get. Monotonicity also makes the evaluation total and cheap: the renderer builds a 1-D table from `GradeCurve.at()` and stops worrying about kinks.
**A curve spans the whole range** | It starts at x=0 and ends at x=1, so the black point and the white point are never undefined, and `at()` holds the end values outside it.
**A LUT is a reference, not a file** | `Lut` carries an id, a name and the path where it was last seen, and never opens one. A project whose LUT is uninstalled opens with the rest of its grade intact, because a missing LUT is missing media and missing media is a state (ADR-0015 rule 3).
**A neutral grade costs nothing** | `is_neutral` on both `ColourGrade` and `GradeSample` lets the compositor skip the pass. Most clips in most projects are ungraded, so protecting that case is worth more than any optimisation inside the pass.
**Ranges are reported, not raised** | `validate_grade` returns the first correction outside its documented range. A grade with a slider pushed too far is still the user's look; the fix is to clamp it, not to lose it.

Units are tabulated in the module docstring and pinned by tests: exposure and
saturation are **stops** (`2 ** x`, so they are symmetric), contrast is linear
about mid-grey, temperature and tint are -1 to +1 in white-balance space, and
`lift`/`gamma`/`gain` are additive per channel. Deliberately not here:
**pixels** — nothing in this module touches a frame buffer, which is why it
imports no NumPy (ADR-0012).

---
