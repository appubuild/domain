# ADR-0012 — GPU as optional per-operation acceleration, never a requirement

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

"GPU acceleration" is a product requirement, and it genuinely matters: a 4K timeline with
blur, glow and colour grading is not interactive on CPU alone. But the same requirements say
*portable EXE*, *offline first*, and *runs on a user's machine we have never seen*. GPU
support is the least portable thing in a video editor:

* driver quality varies wildly (a specific NVIDIA driver + a specific HEVC profile can hang),
* Windows laptops switch between integrated and discrete GPUs mid-session,
* VRAM exhaustion is a normal, expected runtime condition,
* CI machines and many user machines have no usable GPU at all.

A design that requires the GPU cannot be tested, and a design that has a separate GPU render
path produces the worst bug class in this domain: **"it looks different after export."**

## Decision

1. **The compositor is defined once, semantically** (`services/render/compositor.py`) as a
   pure function of `(timeline, t, output_spec) → FrameBuffer`. GPU and CPU are
   *implementations of individual operations*, not alternative pipelines.
2. **`GpuBackend` is a port** with an explicit capability model:
   `supports(op, dtype, colour_space, max_texture_size, vram_budget)` plus
   `allocate/execute/release`. Adapters: `NullGpuBackend` (always available),
   `CudaBackend` (via PyAV hwaccel + OpenCV CUDA when present), `OpenCLBackend`
   (OpenCV T-API / `cv2.UMat`), and `WebGLOverlayBackend` on the frontend for preview-only
   overlays. Each declares the ops it accelerates.
3. **Per-operation partitioning, not per-frame.** An `ExecutionPlanner` walks the effect
   chain and assigns each op to GPU or CPU based on declared support, current VRAM
   headroom, and measured cost, inserting transfers only where the assignment changes.
   Transfer cost is charged explicitly in the planner's cost model, so a chain of five
   GPU-capable ops separated by one CPU-only op does not ping-pong buffers five times.
4. **Fallback is per-op and automatic.** If a GPU op fails (out of memory, driver error,
   unsupported format), the planner retries that op on CPU once, records the failure, and
   *remembers it for the session* so the same op does not fail every frame. The user sees a
   non-modal notice: "Gaussian blur is running on CPU — GPU reported out of memory."
5. **Bit-exactness is a conformance requirement, not a hope.** GPU and CPU implementations
   of the same op must agree within a documented tolerance (`tests/render/test_gpu_cpu_parity.py`,
   default: max abs channel diff ≤ 1/255 for 8-bit, ≤ 1e-3 for float). Ops that cannot meet
   it are marked `approximate = True` in their descriptor, and export refuses to use an
   approximate op unless the user has explicitly accepted a "fast preview quality" mode.
6. **Capability detection happens once per session** and is cached in
   `settings.hw_capabilities` (device name, driver, VRAM, supported hwaccel codecs,
   supported ops, measured throughput). Detection must never hang: each probe runs with a
   timeout, in a worker, and a failed probe degrades to `NullGpuBackend`.
7. **Hardware decode/encode is negotiated separately from compositing.** A machine may
   support `h264_cuvid` decode but have no usable compute path. The export UI therefore lists
   encoders derived from *probed* capability, never from a hardcoded list, and shows why an
   encoder is unavailable.
8. **VRAM is budgeted.** The planner holds a reservation ledger; a job that cannot fit is
   scheduled to CPU or deferred rather than attempting allocation and thrashing.

## Consequences

**Positive**

* The product runs, renders and exports correctly on a machine with no GPU — and CI proves it.
* Preview and export stay identical because there is one semantic definition of each op.
* Adding a Vulkan/Metal/D3D12 backend later is a new adapter plus conformance tests, not a
  rewrite.
* Driver flakiness degrades to slower, not to broken.

**Negative / accepted**

* Two implementations per accelerated op, plus parity tests, is real work. Mitigated by
  accelerating only the ops where measurement shows a win (blur, glow, grain, transform,
  colour LUT, composite blend) rather than everything.
* The planner's cost model needs calibration per machine; a wrong model costs performance,
  never correctness. We ship measured defaults and let the benchmark tool
  (`scripts/bench_render.py`) recalibrate locally.
* Approximate ops must be surfaced honestly in the UI; users may be confused by a quality
  toggle. Accepted — the alternative (silently different exports) is worse.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| GPU-required pipeline | Untestable in CI, unrunnable on many user machines, violates portable/offline requirement |
| Separate CPU and GPU pipelines | Guarantees preview/export divergence — the top defect class in NLEs |
| OpenGL-only desktop compositor | No headless CI path, context management pain across windowing systems, and it does not help the export path |
| Whole-graph GPU (build a filter graph, upload once) | Excellent when it works; but a single unsupported op forces the whole chain to CPU, and dynamic per-clip chains make graph rebuilds frequent |
| Relying on `libavfilter` hwaccel graphs for everything | We lose per-frame Python control needed for captions/text/motion graphics overlays |
