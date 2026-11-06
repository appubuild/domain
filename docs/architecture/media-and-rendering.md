# §7 — Media & rendering architecture

**Part of:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · **Owner:** Architecture Group
**Last reviewed:** 2026-11-06

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

*Status:* the PyAV half is built — `infra/media.py` for decoding (§7.5) and
`infra/render.py` for encoding (§7.7), both reading their capability answers from
`PyAVCapabilityProbe`. Neither resolves a toolchain through the five steps above
yet: they use the libraries PyAV links against, which is step 5. The CLI half,
and the `MediaBackend` that picks between the two, are still to come.

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

Where each stage lives now:

| Stage in the diagram | Module | Built |
| --- | --- | --- |
| `TimelineResolver` | `domain/timeline.py` + `services/render/frames.py` | yes |
| `SourceResolver` (which copy of an asset) | `services/media/cache.py` over `ports/persistence.py::CacheIndex` | yes (§7.17) |
| `FrameSourcePool` · `DecodeStage` | `services/render/pool.py` over `ports/media.py` | yes |
| `EffectChain` | `services/render/kernels.py` over `services/effects/` | yes |
| `TransformStage` · `Compositor` · `TransitionStage` · `ColourStage` | `services/render/composite.py` | yes |
| Preview sink | `services/render/preview.py` + `infra/preview.py` | yes (§7.14) |
| Export sink | the same loop, an encoder sink | yes (`infra/render.py`, §7.7) |
| `SpeedStage` | retiming, constant and ramped | not yet |
| `OverlayStage` | text, captions, motion graphics | not yet (captions, stage 9) |

Design invariants:

* **Frame-accurate by construction.** Time is represented as integer frame numbers at a
  project timebase; `Timecode` converts to/from seconds only at the edges. Floats never
  accumulate across the timeline (ADR-0006).
* **Proxies are transparent.** A clip references an asset; the asset resolves to
  `original | proxy | thumbnail` by a `ProxyPolicy` decided from the preview scale factor.
  Nothing downstream knows which it decoded. The resolver that answers is
  `MediaCache` (§7.17), and it holds one rule above all the others: **the
  fallback runs towards the original**. Asked for a proxy that is not there it
  answers with the original — a cache miss degrades the picture, it never
  removes it, because a preview that turned into a gap while a proxy was still
  transcoding would be the opposite of transparent.
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

**`infra/media.py` — the PyAV adapter.** Both halves of the port live in one module,
because the mapping from FFmpeg's vocabulary to the domain's is the one thing worth
sharing: a prober and a decoder that described the same file differently would produce a
timeline laid out at the wrong size. `describe_container()` is the single description both
halves return, and `tests/infra/test_media_decode.py` asserts a decoder's `info()` equals a
prober's `probe()` on the same file.

| Class | Port | Lifetime |
| --- | --- | --- |
| `PyAVProber` | `MediaProber` | stateless, shared across threads (§10) |
| `PyAVDecoder` | `MediaDecoder` | stateless; `open()` answers a handle |
| `PyAVMedia` | `DecodedMedia` | the pooled handle: one container, one description |
| `PyAVVideoSource` | `VideoFrameSource` | one video stream, RGB24 `FrameBuffer` per frame |
| `PyAVAudioSource` | `AudioSampleSource` | one audio stream, interleaved float32 blocks |
| `PyAVResampler` | `AudioResampler` | stateless; one libswresample per call |

Five decisions the decode half makes, each one pinned by a test:

1. **A read is self-contained.** Every read seeks first (except the very first on a fresh
   handle), because `keyframe_indices()` demuxes the container to its end and
   `container.decode(video)` demuxes the whole file, dropping the packets of the stream you
   did not ask for. A source that trusted the container's position would answer the next
   caller with the wrong frames. The cost is one seek per read, well inside the "random
   access may cost a GOP" the port allows.
2. **A file that cannot be seeked is still readable forwards.** A still, or a pipe, may
   refuse a seek; when the caller asked for position 0 the adapter decodes from wherever the
   stream is instead of failing a read that would have worked.
3. **Audio arrives in the domain's layout, or is converted here.** AAC decodes to planar
   float, a WAV to packed 16-bit integer. Anything that is not already float goes through
   libswresample inside the adapter, so no consumer downstream ever meets a second layout.
4. **Blocks are never split.** `samples(count=…)` treats the count as a maximum and returns
   whole decoder blocks, because a render job writes blocks straight into a muxer and
   splitting one would cost a copy for no benefit; the caller trims the partial block, which
   is what the port says.
5. **The resampler is created per call.** libswresample carries delay between calls, so one
   shared instance would leak the tail of one buffer into the head of the next.
   `PyAVResampler` holds no state a caller can observe.

**Pooling.** Not yet built: the `FrameSourcePool` that owns handle lifetimes, hands one
handle to one task (ADR-0007 §5) and closes them idempotently under both the pool's eviction
and a caller's `finally`. The adapter is written for it — a handle is not thread-shared, and
closing the last source closes the handle.

*Still to build:* `infra/media/cli.py`, the FFmpeg-CLI adapter ADR-0007 §2 needs for
rotation the bindings cannot see, frame counts on containers without an index, and
discontinued codecs; the pool above; and `tests/media/test_backend_conformance.py`, which
runs both backends over the same generated assets and asserts identical metadata.

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

**`infra/render.py` — the PyAV renderer.** The encode half; the decode half is
`infra/media.py` (§7.5). One module, matching the media adapter's shape rather
than the two-package layout sketched below, because the split that matters is the
one the port drew.

| Class | Port | Lifetime |
| --- | --- | --- |
| `PyAVRenderer` | `Renderer` | stateless; `open(spec, path, *, is_cancelled=None)` |
| `PyAVRenderTarget` | `RenderTarget` | writes to a sibling `.part`, publishes at `finish` |
| `PyAVFrameSink` | `FrameSink` | RGB/RGBA/gray in, the spec's pixel format out |
| `PyAVAudioSink` | `AudioSink` | resamples to the output's rate and layout |
| `PyAVCapabilityProbe` | `CapabilityProbe` | measured, cached, re-probed on `refresh=True` |

Six decisions, each pinned by `tests/infra/test_render_encode.py`, which writes a
file and decodes it back with the other half of the media layer:

1. **The destination does not exist until it is finished.** Frames go to
   `<name>.<random>.part` beside the output and are `replace`d at `finish`. A
   failure, a cancellation or a crash leaves the previous export intact, and a
   test asserts that a sentinel file at the destination is still there while
   frames are being written.
2. **A spec is proven by opening the encoder.** `open` builds a throwaway context
   with the real width, height, pixel format, rate and options and opens it:
   DNxHD exists only for a handful of size/rate/bitrate triples, a hardware
   encoder can be listed and unusable, and `gbrp` is a format `swscale` can make
   that H.264 cannot hold. One context open — milliseconds — before frame one.
3. **Hardware is proven, not listed.** `hwaccels` holds only the families whose
   encoders actually opened, because FFmpeg compiled against NVENC and a machine
   with a usable NVIDIA driver are different facts (ADR-0012 §7). It measures
   `[]` on the CI sandbox, which is the honest answer for it.
4. **Colour is converted once, here, and tagged.** `swscale` is told the matrix
   the frame declares and the one the output wants; the four tags are written to
   the encoder context, and an unspecified tag is left unspecified rather than
   guessed. One measured limit: PyAV 18's `reformat` takes no destination
   *range*, so a conversion between two different ranges is not expressible and
   belongs to the compositor, which works in RGB.
5. **Audio is resampled per source shape.** One libswresample per (rate,
   channels), each flushed at `finish`, because libswresample carries delay and a
   shared instance would leak one block's tail into the next block's head.
6. **Cancellation is a callable, not a job.** `is_cancelled: Callable[[], bool]`
   is injected at `open` — a bare callable, like every other collaborator here —
   so the renderer never learns what a job is. Once it answers `True`, every
   later write fails with `NS-RENDER-4005`.

Rate control is mapped per codec against the bundled FFmpeg: `crf` for x264,
x265 and VP9 (which also needs an explicit zero budget or it treats `crf` as a
ceiling under a default bit rate), `qscale` for MPEG-4, a profile for ProRes —
`4444xq` with alpha and `hq` without, because asking for 4444 XQ on a 4:2:2
stream silently promotes it to twelve bits — and `b`/`minrate`/`maxrate` for the
bit-rate modes.

*Still to build:* `infra/render/cli_encoder.py`, the FFmpeg-CLI adapter the
multi-pass and libavfilter-graph exports need; the `MediaBackend` binding that
chooses between the two at composition time (ADR-0007 §3); the `ExportSink`
wiring in §7.2; and `tests/render/test_gpu_cpu_parity.py` for ADR-0012 §5. The
GPU compute half gets its own port — `ports/gpu.py`, `GpuBackend` with
`supports/allocate/execute/release` — because a compute device has a different
lifetime from an encoder.

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

### 7.12 The compositor (`services/render/composite.py`)

One function turns a plan and a set of decoded pictures into a frame, and both
the preview loop and the exporter call that one function. This is the invariant
§7.2 promises — "the preview looks different from the export" is structurally
impossible — and it is why the compositor is a *function of a value*: a
`FramePlan` plus the pictures it asked for, nothing else. No clock, no cache,
no I/O, no state. Given the same inputs it returns the same bytes, which is
what lets a resumed render produce the file it would have produced (ADR-0002
rule 1) and what lets a preview frame be compared pixel for pixel against its
export in a test.

```
   FramePlan  ──┐                        ┌── per layer, bottom first ─────────┐
                │                        │  1. crop + mirror   (source side)  │
   pictures  ───┼──► composite_frame ────┤  2. clip effects, then track        │
                │        │               │  3. clip grades, then track         │
   ImageOps  ───┘        │               │  4. one affine transform            │
   kernels ──────────────┤               │  5. opacity × transition opacity    │
   luts ─────────────────┘               │  6. source-over onto the canvas     │
                                         └─────────────────────────────────────┘
                                                        │
                         ┌── once, over the result ─────┴──────────┐
                         │  7. output effect chain  8. output grade │
                         └───────────────────┬─────────────────────┘
                                             ▼
                                      FrameBuffer (rgb24)
```

Decision | Why
--- | ---
**Crop and mirror are source-side** | A pixel that is cropped away must not have been blurred, sharpened or graded on its way to being thrown out. Mirroring is an array flip rather than a negative scale in the matrix, because a flip is exact and a negative scale lands the picture a fraction of a pixel off its own centre.
**One affine matrix per layer** | Scale ∘ rotation ∘ skew, composed about the anchor and then positioned. Three warps would resample three times and soften the picture; one warp resamples once.
**Transitions are not a special case** | A mix is an opacity, an offset and a scale carried on *both* layers, plus `fill` for a dip. The compositor reads them where it already reads geometry and alpha, so a push and a dissolve are the same code path — and a transition that runs out of partner degrades to a plain cut instead of a crash.
**The canvas starts transparent** | Video has no alpha channel, so the canvas is baked against the transition fill (or black) at the very end. Baking earlier would mean a lower layer could never show through a translucent upper one.
**A missing picture skips its layer** | An offline asset must not cost the frame: the layer is omitted, the layers under it still draw, and the export records the gap. A black rectangle over everything beneath it would be a worse lie than the gap (ADR-0015 rule 3).
**A LUT with no reader raises** | Silently ignoring it would ship a file with the wrong look in it. `luts` is injected, so the compositor never opens a file, and a project with no LUT needs no reader at all.
**No colour conversion between sources** | The working space is whatever the decoder produced; the compositor cannot know whether two clips were tagged the same, and guessing would be a silent error. The caller tags the *result* (`colour=`), which is the only tag that reaches the file. This is recorded as a limit, not a bug: cross-source conversion belongs at the decode boundary, once, where the tags live.

The working space is **float32, 0..1, straight alpha**: one conversion in, one
out, per chain — not per effect. Colours are clipped once, at the end, because
clipping between passes is how a highlight turns into a flat white patch.

`apply_grade` is public and separate so a thumbnail, a still export or a
captions overlay can grade a single picture without compositing a frame. Its
order is fixed and pinned by tests: exposure (×2^e) → contrast about mid-grey →
white balance → gain/lift → gamma → saturation about Rec.709 luma → curves
(one 256-entry table per channel) → LUT last, trilinear over the eight corners
of a cube, mixed by `lut_strength`.

Public API (everything else is private and may move):

Symbol | What it does
--- | ---
`composite_frame(plan, pictures, *, ops, kernels=None, luts=None, colour=None)` | The frame. `ops` is required; the rest default to the built-ins and to "no LUT reader".
`apply_grade(sample, buffer, *, luts=None)` | One `GradeSample` over one picture. Returns the *same object* when the grade is neutral.
`LutTableReader` | `Callable[[Lut], Any]` — how to turn a LUT into a table.

**Performance.** The frame is allocated once per layer and reused as the
destination; the transform is a single `warpAffine`; effects share one float
round trip per chain; a neutral grade is skipped by `is_neutral` before any
array is touched. Nothing is cached — caching belongs to the caller (the
preview loop's frame cache, §7.2), because a cache inside a pure function is a
second source of truth about what a frame is.

**Testing.** `tests/services/test_render_composite.py` asserts on pixels at
64×48, because a property that needs a megapixel to demonstrate is a property
nobody can debug: geometry and the anchor, layer order, that half-transparent
white over black is 128, that a dip and a dissolve differ only by `fill`, that
grain is reproducible per frame and different between frames, and that the same
frame twice is byte-identical.

**Future expansion.** Blend modes and masks (already in the domain, not yet
applied here) slot in at step 6; a 32-bit float pipeline changes only the
working-space constants; tile-based rendering for 8K changes the caller, not
this function.

### 7.13 The imaging port (`ports/imaging.py`, `infra/imaging.py`)

A compositor is arithmetic on arrays, and nearly all of it is NumPy. Six
operations are not: resampling, warping, convolution, blurring and padding are
where a real implementation earns its speed, and they are the only reason an
effect engine would reach for a library. `ImageOps` is that reach.

```
 services/render/kernels.py ──┐
 services/render/composite.py ─┼──► ports.imaging.ImageOps  ◄── infra/imaging.py (OpenCV)
        (declare only)         │         (6 methods)         └── a GPU adapter (ADR-0012)
                               │                             └── tests/media/numpy_imaging.py
```

Decision | Why
--- | ---
**A port, not an import** | OpenCV is confined to `infra` by `scripts/check_layering.py`, but the rule is only half the reason: there are two implementations we intend to ship (CPU and GPU, ADR-0012 §2). A renderer that imports `cv2` can have neither, and its unit tests cannot run without it.
**Six operations, no more** | Every entry is something NumPy cannot do well and a kernel genuinely needs. A port that grows an operation per effect has become OpenCV with extra steps.
**Float in, float out, never clipped** | Clipping is a compositing decision made once, by the caller. An operation that clipped would silently change the look of anything downstream of it.
**Rank is preserved** | OpenCV collapses `HxWx1` to `HxW`. The adapter puts the axis back, so a caller that built a one-channel mask does not have to inspect what came back before indexing it.
**Borders are stated, not inherited** | OpenCV defaults differ per function; inheriting two different defaults is how a blurred frame gets a dark rim while a warped one does not. Blurs replicate, warps are constant — and a constant border fades rather than crops, so a layer dragged half off the frame softens at its own edge.
**Degenerate inputs are handled in the adapter** | A zero sigma, a box of one, an empty kernel: each returns the input. No kernel has to guard against them.

Method | Contract
--- | ---
`resize(pixels, size, *, interpolation)` | Exact `(width, height)`; the caller has already decided the rounding. Nearest never invents a value — the one mode safe for a mask.
`warp_affine(pixels, matrix, size, *, interpolation, border)` | The matrix maps **source → destination** (OpenCV's default, without `WARP_INVERSE_MAP`); an adapter inverts it internally, because a gather can only ask where each output came from.
`gaussian(pixels, sigma)` / `box(pixels, size)` | Kernel size is the adapter's business. Edge replicated: a dark rim is an artefact, not a picture.
`convolve(pixels, kernel)` | The escape hatch — motion blur is a rotated line. An unnormalised kernel is normalised, so a hand-built one cannot become a brightness change.
`edge_pad(pixels, top, bottom, left, right)` | Grow by repeating edge pixels: what a channel scaled *down* needs to be fitted back to its frame.

**Testing.** `tests/infra/test_imaging.py` checks the OpenCV adapter against
`tests/media/numpy_imaging.py`, a second implementation in plain NumPy — no
SIMD, no fixed-point, explicit loops. Where they agree, OpenCV is not quietly
doing something else; where they disagree by more than rounding, one of them is
wrong. Comparing an implementation against itself would prove nothing, and a
reference that shares an optimisation with the thing it checks shares its bugs.
The contract is then asserted without a tolerance: dtype preserved, one- and
four-channel inputs both work, blur replicates its edge, warp leaves outside
transparent, and one call twice gives one answer.

**Future expansion.** A GPU adapter (ADR-0012) implements the same six methods
and is bound at composition time — no renderer changes. `Interpolation.CUBIC`
and `BorderMode.REPLICATE` are already declared for the cases that will want
them.

### 7.14 The preview service (`services/render/preview.py`, `infra/preview.py`)

Everything above this section is about producing a `FrameBuffer`. This section is
about the two things that happen next in the *preview* path only: making the
frame small enough to send, and sending it.

```
 api/routers/render.py      GET  …/preview/frame   → image/jpeg + geometry headers
                            POST …/preview/warm    → how much is decoded ahead
                            DELETE …/preview/cache → drop pictures, keep decoders
        │  Depends(workspace)
        ▼
 api/workspace.py           one PreviewRenderer per open project, closed with it
        │
        ▼
 services/render/preview.py PreviewRenderer.frame(project, n, viewport=…, zoom=…)
        │                     ├── render_preview_frame(…)   ← the export's compositor
        │                     ├── plan_preview(…)           ← scale, offset, warm set
        │                     ├── ops.resize(…, down only)
        │                     └── encode(…)                 ← FrameEncoder, injected
        ▼
 infra/preview.py           encode_frame → Result[bytes]   (cv2.imencode, JPEG/PNG/WebP)
```

Decision | Why
--- | ---
**One renderer per open project, owned by the workspace** | It holds a `FrameSourcePool`: decoders that stay open and pictures that stay decoded. Built per request, a scrub reopens a file per frame; shared between projects, it decodes one project's assets into another's frames.
**The frame endpoint answers an image, not JSON** | A base64 picture is a third larger and is decoded on the UI thread of a panel that is already busy. The parts a client *reads* — scale, offset, size, gaps — travel in headers.
**Never upscaled** | Pixels above 1:1 are not information. Zoom buys detail up to the project's own size and no further; the panel scales the image it was given.
**Two sizes, not one** | `PreviewFrame.size` is the encoded picture; `PreviewFrame.plan.size` is the rect the panel draws it into. At zoom they differ, and a panel that sized its `<img>` from the plan would stretch the picture by exactly the zoom factor.
**Warming is its own request, and a batch** | Fifteen frames cost fifteen decodes and **one seek** when read together. Done inside the frame request, it would add the latency of work the user has not asked to see — and would warm the frames they are scrubbing away from.
**Invalidation follows the command's own `invalidate` set** | Cache invalidation is a subscriber, never a call site (§7.8). A workspace that cleared the cache on every edit would throw away every decoded picture on a pure selection change.
**`resolve_asset` returns `None` for a proxy or a thumbnail** | Generating them is the media layer's job, and features may not import each other (ADR-0002 rule 4). `None` becomes a gap, which is what lets an unlinked project still lay out and preview (ADR-0015 rule 3).

Endpoint | Contract
--- | ---
`GET /api/v1/projects/{id}/preview/frame` | `?frame&width&height&zoom`. `200 image/jpeg`, `Cache-Control: no-store`, plus `X-Nova-Preview-{Scale,Offset,Size,Gaps}`. `404` when no such project is open; `422` at the boundary for a negative frame or a two-pixel panel.
`POST /api/v1/projects/{id}/preview/warm` | `{frame, count?}`. Answers `warmed`, `cached_bytes`, `open_sources`, `seeks`, `gaps`. The seek count is the number to watch: one per clip per run, not one per frame.
`DELETE /api/v1/projects/{id}/preview/cache` | `{cleared, cached_bytes, open_sources}`. Pictures go; decoders stay, because the files did not change.

**Error handling.** A missing asset is not an error: the layer is skipped, the
frame is drawn and the id appears in `X-Nova-Preview-Gaps`. A frame that cannot
be *encoded* is, and comes back as `problem+json` through the same handler every
other router uses. An unopened project is a `404` carrying `NS-PROJECT-4040`,
which is the transport's verdict on the URL rather than the domain's opinion of
the severity.

**Caching.** Two caches, at two levels, with two different lifetimes: the pool's
byte-budgeted picture cache (cleared by an edit, bounded in bytes so a 4K project
cannot exhaust the machine) and nothing at all on the wire — a preview is a
rendering of a timeline that is being edited and has no identity to be cached
under.

**Performance.** The whole strategy is *decode once, in order*: one renderer per
project, decoders held open, warming in batches, and the composite done at the
project's own size before a single downscale. The invariant is asserted, not
hoped for — ten warmed frames of one clip is one seek, in the service test and
over HTTP alike.

**Testing.** `tests/services/test_preview_renderer.py` (29) drives the renderer
on the seek-counting fake: never upscaled, zoom capped at the project size, a gap is
not a failure, invalidation drops pictures and keeps decoders, warming ten frames
costs one seek. `tests/api/test_render_api.py` (22) drives it through HTTP with a
clip encoded in a temporary directory by PyAV — the frame arrives as JPEG with
`no-store`, the headers describe it, closing a project closes its renderer and
its file handles, and an edit invalidates the cache by itself.

### 7.15 The export job (`services/render/export.py`)

Previewing a frame and exporting a range are the same loop with a different
sink. What an export adds is everything the preview never has to answer: it runs
for minutes, it can be stopped, it must not leave a half-file, and somebody is
watching a bar.

```
routers/export.py (to come) ──► JobExecutor.submit(spec, body)
                                        │
                                        ▼
                        ExportVideoJob(project, request, *factories)(context)
                                        │
        ┌───────────────────────────────┼────────────────────────────────┐
        ▼                               ▼                                ▼
 renderer_factory()             FrameSourcePool              _ProgressSink
 -> Renderer.open(spec, path)   (decoder_factory(),          counts writes,
    -> RenderTarget                resolve)                  reports, checkpoints
        │                               │                                │
        │                               ▼                                │
        │                    render_frames(…, cancel=context.is_cancelled)│
        │                               │                                │
        └──────────────► target.finish() ◄───────────────────────────────┘
                         (the commit point: index, trailer, rename)
```

Decision | Why
--- | ---
**A job body, not a function** | It takes a `JobContext` and returns `Result[JobOutcome]`. Nothing here knows what a thread, a process or a WebSocket is (ADR-0010 §1) — which is also why a test can run an entire export by calling it.
**Data, not a closure** | An export is CPU-bound for minutes: it runs in the process pool, and Windows `spawn` pickles the body. So it is a frozen dataclass of frozen values plus **module-level factories**, and it builds its decoders, renderer and clock *inside* the worker. A body that captured an open decoder is unpicklable — refused at submit time rather than forty minutes in.
**Federated assembly** | `services` may not import `infra` (ADR-0002 rule 2), so the composition root supplies the factories and gets both: the real ones in production, fakes in a test, and no second copy of the wiring.
**Progress lives on the sink** | The loop's job is to render frames in order; wrapping the sink keeps it unchanged and puts the count exactly where the thing being counted happens — after a *successful* write, the only count a user cares about.
**Two finishes** | `render_frames` finishes the *stream* (flush the encoder); `target.finish()` commits the *container* (index, trailer, promote the temporary file). Reporting the muxing stage at the flush would park the bar at 100 % while the trailer was still being written — the exact hang the stage exists to distinguish.
**A gap does not fail the export** | An offline asset means a hole in the picture, ids in the progress payload and a count in the summary. Refusing to export a project with one unplugged drive is refusing nineteen clips that are fine. An export that must be complete sets `fail_on_missing`, and then the same situation is refused *before* the first frame.

Stage | What it means
--- | ---
`preparing` | Probing the encoder and opening the destination. Slow the first time, and worth saying out loud.
`encoding` | One report per frame: `frame`, `frames`, and an ETA once there is a rate to extrapolate from — never from the first four frames.
`muxing` | The container is being finalised.
`done` | Terminal, always published, carrying the summary a user reads.

**Caching / performance.** The pool's cache is deliberately an eighth of the
preview's: a forward export reads every frame once, so a large cache is memory
spent to avoid work that will not happen. Resume points are written every 120
frames, and the export is declared idempotent so a lost worker can be retried
without asking the user.

**Testing.** `tests/services/test_render_export.py` (44): staged progress and
resume points, a cancellation that stops between frames and leaves no file, an
encoder rejection at frame four that leaves no file, an unwritable destination
refused before a frame is decoded, gaps tolerated and `fail_on_missing`
refusing, and a pickling test that fails a body built with a closure. One test
touches FFmpeg: a clip encoded by PyAV, exported through `PyAVRenderer`, opened
again and counted.

### 7.16 The job executor and the job history (`infra/jobs.py`, `infra/persistence/jobs.py`)

A job body can be called directly, which is what makes it testable — but a user
does not call it. Something has to record it before it starts, run it somewhere
it cannot hurt the UI, stop it when asked, and report while it runs.

```
 submit(spec, body) ──► store.put(record)        ← BEFORE anything runs (rule 4)
        ┌────────────────────┴─────────────────────┐
        ▼                                          ▼
 THREAD isolation                            PROCESS isolation
 ThreadPoolExecutor                          one process per job
 └─ _Context (flag, report, checkpoint)      ├─ mp.Queue → reader thread → observers
                                             └─ mp.Event ← cancel()
        └──────────────────┬──────────────────────┘
                           ▼
        settle → store.put → observers.on_status
        (RUNNING → SUCCEEDED | FAILED | CANCELLED | INTERRUPTED)
```

Decision | Why
--- | ---
**A process per job, not a process pool** | `ProcessPoolExecutor` gives a worker no way to send anything home until it returns — progress would arrive at the end, which is the refresh-timer UI ADR-0010 §7 rules out. A process of its own, with an inherited `Queue` and `Event`, reports as it goes. The cost (~50 ms on Linux, ~300 ms on Windows) is nothing against an export measured in minutes.
**`spawn`, never `fork`** | A forked worker inherits the event loop, the sockets and the locks; a job that touched them would corrupt the editor rather than fail. It is also what Windows does.
**The record is written before the work starts** | The last thing the process did is always on disk — the whole of post-crash reporting. A job whose history cannot be written is refused rather than run.
**Settled before completed** | The record closes *before* the future does, so `wait()` returning means the record is final, not that it soon will be.
**Cancellation is cooperative, then hard** | A process is terminated after its grace period (30 s for an export, so a job mid-mux is not killed into a corrupt file). A thread cannot be killed: its record is closed with `NS-JOB-5004` and the worker is left to end.
**Progress is throttled, the edges are not** | 20 Hz, but a stage change and the terminal report are always published: a bar frozen at 99 % is indistinguishable from a hang.
**A dead worker is a value** | An exception in a body is `NS-JOB-5006`; a worker that died is `NS-JOB-5003`. The editor survives both; the scheduler decides on retry.

Adapter | For
--- | ---
`ConcurrentJobExecutor` | Threads for short work, a process each for long CPU-bound work.
`ThreadPoolJobExecutor` | Tests, and the frozen Windows build until it can call `freeze_support()`. A process job is refused at once rather than run in the wrong place.
`JsonJobStore` | The history as one JSON file in the data directory, written whole and atomically (staged beside, `os.replace`). Rows move to `ai_jobs`/`export_jobs` (ADR-0004 §6) as a constructor argument, not a rewrite.

**Reconciliation.** At startup `reconcile_interrupted()` turns every
non-terminal record into `INTERRUPTED` — a job that was running when the editor
closed neither failed nor finished — and pruning deletes terminal records only,
so a crash cannot disappear a job that might still be resumable.

**How a client reaches it.** The executor is behind `app.state.jobs` and the
HTTP surface is `api.md` §11: `POST /api/v1/projects/{id}/exports` submits and
answers `202` with a job id, and `api/job_events.py` puts `job.progressed`,
`job.status` and `job.failed` on the bus, which is how progress reaches a panel.
Nothing in this section knows about HTTP, and nothing in `api/` knows how a
worker is started — the seam is the `JobObserver` port.

**Testing.** `tests/infra/test_jobs.py` (47): an exception becomes a value; a
burst of 200 reports is throttled while a stage change and the terminal report
survive; a cancelled job is *cancelled*, not *failed*; a job that will not stop
is closed by the watchdog; a second job is refused when there is one slot and
accepted once it frees; an unpicklable body is refused before a worker is
scheduled; and two tests start a real process and read progress back across the
boundary.

**Future expansion.** Retry and the circuit breaker (the scheduler), a waiting
queue with priority deferral (`decide_admission` already returns the verdict),
and resume-from-checkpoint — the checkpoint is already on the record, and an
export writes one every 120 frames.

**Future expansion (export job).** The audio mix is the obvious gap: `RenderTarget.audio()`
already exists and the job ignores it, because there is no mixer yet (§7.4).
Resume from a checkpoint — restarting at frame *n* — needs the executor and a
store, both of which land with the job scheduler. Segment-parallel export
(render four ranges into four files and concat) is a scheduler decision this body
never has to know about.

**Future expansion (preview).** `FrameFormat.PNG` and `WEBP` are already implemented in
`infra/preview.py` and selectable at the composition root; which one a session
serves becomes an `ApiSettings` field the day a client needs it. The desktop
shell replaces the JPEG sink with shared memory (§7.2) and nothing above
`infra/` changes.

### 7.17 Which copy of a file a decode reads (`services/media/cache.py`)

`SourcePlan` is `asset_id -> source name` (`services/render/loop.py`), and the
`FrameSourcePool` translates it with an injected `SourceResolver` —
`(asset_id, source) -> path | None`. For a long time the only implementation
answered "the original, and nothing else". `MediaCache` is the real one, and it
is the object that keeps §7.2's transparency promise.

```
                 sources_for(project, scale)          one Mapping for one frame
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
     ProxyPolicy.decide(scale, available)   _available(asset)
     "which copy is wanted"                 "which copies we hold"
              └───────────────┬────────────────┘
                              ▼
                    asset_id -> "proxy"
                              │
     resolve(asset_id, source) ── fallback towards the original
                              │
                    <cache>/<kind>/<key>
```

**Where the bytes live.** `<data_root>/cache.sqlite3` is the index;
`<data_root>/cache/proxy/proxy-<asset_id>-h<height>.mkv` and
`<data_root>/cache/thumbnail/thumb-<asset_id>-f<frame>-w<width>.jpg` are the
bytes — one subdirectory per `CacheKind`, so "clear the thumbnail cache" is a
`rm` and not a query. Keys come from `services/media/keys.py` and are *derived,
never assigned*: the same asset at the same size produces the same name for the
life of the install, which is what makes a disposable cache worth having
(ADR-0015 rule 6). A name is refused if it is not a single file name — the
domain's document-name predicate allows `clips/a.json`, and a cache key is not
an archive entry.

**Four rules, each one a bug going the other way.**

1. **A missing copy degrades the picture; it does not remove it.** The fallback
   chain runs thumbnail → proxy → original. Only a missing *original* yields
   `None`, and that is a relink, not a cache miss.
2. **Holding a copy needs an entry *and* a file.** An entry with no file
   promises pictures that cannot be produced; a file with no entry is disk
   eviction will never reclaim.
3. **Bytes first, row second — in that order — when forgetting.** An interrupted
   removal then leaves an entry pointing at nothing, which rule 2 already reads
   as a miss, rather than unreachable bytes no entry names.
4. **The read path does not write.** "Which copy should I decode" is asked sixty
   times a second while scrubbing, so a use is noted at most once per key per
   five seconds: LRU is a *ranking*, not a log.

**The index is shared between threads, and that was not obvious until it broke.**
A `def` route handler runs in FastAPI's thread pool, so the cache index was being
read from whichever thread picked up the request by a connection opened at
startup — a `sqlite3.ProgrammingError` under load. `SqliteGateway(shared=True)`
opens with `check_same_thread=False` and serialises every statement behind a
lock, and `open_shared_cache_index()` is what the composition root binds. The
gateway's default is still one owner and one thread, and that default is a
promise rather than an accident: a private connection used elsewhere is refused,
which is how a caller learns it needed the shared one.

**The session closes it.** `ProjectWorkspace.close_cache()` closes the index it
opened — last, after `close_all()`, because the cache outlives any one project.
A cache opened somewhere else and handed in is not closed by the workspace.

**Warming is told the panel size.** `POST …/preview/warm` requires `width` and
`height`: a frame is decoded from one copy and cached under it, so a warm that
guessed the scale would fill the pool with frames nobody will ask for.

**Testing.** `tests/services/test_media_cache.py` (36) pins the fallback, the
entry-and-file rule, the throttled touch, and `sources_for` against a dict
index, a set-backed disk and a clock that only moves when a test moves it — no
SQLite, no filesystem, no decoder. `tests/infra/test_persistence_sqlite.py` pins
the shared gateway: a private connection is refused from another thread, a
shared one is not, twenty-four concurrent writers leave twenty-four rows, and a
reader never sees another thread's cursor.

**Making the copies** (`services/media/generation.py`) is the other half, and it
is *jobs*, not calls. `ProxyJob` and `ThumbnailJob` are frozen bodies holding
**factories** — a decoder, a renderer, pixel operations, a still sink, a cache
index — so the body can be pickled and run in a worker process (ADR-0010 §1),
where it builds its own collaborators. Nothing runs on the request path: a
service that transcoded while the user was dragging a clip is how an editor
earns a reputation for freezing.

The two jobs deliberately reach different things. **Proxies are planned for the
assets the timeline references; thumbnails for every asset in the project.**
Transcoding two hundred files somebody imported but never cut is how a cache
becomes forty gigabytes, while eight decodes of each is how a media bin becomes
browsable — and eight decodes cost less than the probe that found the file.

Three rules the bodies hold to:

1. **A job that fails leaves nothing.** The renderer stages beside its target
   and promotes on `finish`, the still sink renames into place, and both bodies
   abort on failure. Neither records a row until the bytes are complete, because
   a row is a promise eviction will collect on.
2. **A cancelled job is "stopped", not "failed"** — `NS-JOB-5005`, polled
   between frames (between stills), never fatal.
3. **Stills are recorded as they land.** A job interrupted after five thumbnails
   has left five the panel can show, which is better than none.

The thumbnail key names the frame the strip *asked* for, not the frame the
decoder landed on: a still is snapped back to the nearest keyframe, because a
sparse seek into long-GOP footage costs a whole group of pictures and at
thumbnail scale frame 20 stands in for frame 37 exactly. That mapping is a pure
function of the file, which is what keeps the cache stable across a reopen.

**Future expansion.** Byte-budgeted eviction over `select_for_eviction` is the
other half of `record`, and the reason every row carries a size — the API to
serve it (`entries`, `drop`) already exists (§7.18). Nothing in `MediaCache` has
to change for it: the producer calls `record()` when the file is complete, and
the planner calls `forget()` when the budget says so. Audio in the proxy waits
on the mixer (§7.4): the frame pool is video-only today, so a proxy is too.

### 7.18 Asking for the media a project needs (`api/media_jobs.py`)

§7.17 answers "which copy should I decode", and this section answers the
question underneath it: *who made that copy*. `MediaJobFactory` is the
composition-root twin of `ExportJobFactory` (§11): it knows nothing about HTTP,
takes a project and a cache, and answers with a tuple of `PlannedJob` — a body,
the spec to run it under, and the `kind`/`asset_id`/`count` a caller needs to
describe it without importing the service's vocabulary.

```
  routers/media.py            api/media_jobs.py            services/media
  ┌──────────────────┐  plan  ┌────────────────────┐  ┌───────────────────┐
  │ EnsureMediaRequ- │───────►│ MediaJobFactory    │─►│ proxy_requests    │
  │  est {proxies,   │        │  renderer/ops/     │  │ thumbnail_requests│
  │  thumbnails}     │        │  decoder/still =   │  └─────────┬─────────┘
  └────────┬─────────┘        │  module-level fns  │            │ grouping
           │ 202 + jobs       └─────────┬──────────┘            ▼
           ▼                            │              ProxyJob / ThumbnailJob
   jobs.submit(spec, body)  ◄───────────┘                       │ pickled
           │                                                    ▼
           ▼                                          worker: its own decoder,
   ┌──────────────────────────────────────┐           its own cache index
   │ EnsureMediaResponse                  │
   │  jobs: [ {job_id, kind, asset_id,    │
   │           count, status, detail} ]   │
   │  proxies, strips, summary            │
   └──────────────────────────────────────┘
```

Four decisions, and each is the difference between a cache and a liability:

1. **Asking is free, and asking twice is free.** `plan` is a read — the
   planners are pure, and a hit costs one index lookup per asset — so the
   endpoint may be called on an import, on a repaint or on a timer. A project
   that is up to date queues nothing and says so in `summary`.
2. **One job per asset, not one per still.** A strip of eight thumbnails is
   eight seeks inside *one* job on the thread pool: a job per frame would spend
   eight pickles and eight scheduler hand-offs to open the same file eight
   times. Proxies, which are minutes of CPU, get one job each in the process
   pool.
3. **A job is deduped by artefact, not by asset.** The dedupe key is
   `proxy:<cache key>`, so a request for a different target size is different
   work rather than a duplicate to be dropped — and twenty panels asking for
   the same clip share one transcode.
4. **A worker builds its own cache.** `MediaJobFactory` holds `data_dir`, not a
   live `MediaCache`: the workspace's cache holds a SQLite connection, and a
   connection does not pickle. `partial(new_cache, data_dir)` runs inside the
   worker, which is also why the index is opened shared (§7.17).

**The cache is install-wide, so its verbs live there too.** `GET
/api/v1/system/cache` lists what is held — oldest use first, which is the order
eviction will take them in — and `DELETE /api/v1/system/cache` (optionally
`?kind=proxy|thumbnail`) frees it, answering with how many entries and how many
bytes went. Both are on the system router rather than under a project, because
one project's proxies are not another's and deleting by project would leave
entries no project claims.

**Testing.** `tests/api/test_media_jobs_api.py` (19) pins the response — 202
with the jobs, nothing queued when everything is held, `proxies=false` and
`thumbnails=false`, 404 for a project that is not open, 503 for a full pool —
and one test runs the real executor end to end: two jobs settle as `succeeded`,
the cache then lists one proxy and one thumbnail, a second ask queues nothing,
and the delete frees both. `tests/services/test_media_cache.py` (42) pins
`entries`/`drop` against the dict index, including the rule that a row whose
file has gone is not something we hold.

---
