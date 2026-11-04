# ADR-0007 — PyAV-first media I/O with a CLI fallback backend

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

Nova Studio must decode, probe, transcode, filter and mux dozens of formats, on machines
with and without GPUs, inside a portable EXE that must not require the user to install
anything.

Two FFmpeg access strategies exist:

* **Library access (PyAV)** — in-process, gives `VideoFrame`/`AudioFrame` objects we can
  convert to NumPy arrays for our own compositor, no process spawn cost, precise control of
  seek/discard/flush.
* **CLI access (`ffmpeg` binary)** — full `libavfilter` graph support (`-filter_complex`),
  hardware-accelerated pipelines that are awkward via bindings, robust multi-pass export,
  and battle-tested muxing.

Relying on only one is a mistake: the CLI cannot hand us frames for a Python compositor
without a rawvideo pipe (which costs a full frame copy per frame and loses precise seeking),
while the library path makes complex filter graphs laborious to build by hand.

A further constraint we verified in this environment: a system `ffmpeg` binary is **not
guaranteed** (Debian sandbox had none; apt repositories were unreachable). Yet
`imageio-ffmpeg` ships a static FFmpeg 7.0.2 binary as a Python dependency, and PyAV 18.1
wheels bundle FFmpeg 7 libraries with `libx264`, `hevc`, `vp9`, `aac`, `libmp3lame` all
encodable.

## Decision

1. **PyAV is the primary backend** for probe, decode-to-frame, thumbnail extraction,
   waveform extraction and preview compositing. Frames become `FrameBuffer`
   (`domain/media.py`) — a thin typed wrapper over a NumPy array plus colourspace metadata.
2. **The FFmpeg CLI is the secondary backend**, used for: complex `filter_complex` graphs,
   multi-pass/CRF-constrained export, hardware encode paths (`h264_nvenc`, `hevc_qsv`,
   `h264_amf`, `videotoolbox`), proxy generation, and fast remux/stream-copy operations.
3. A **`MediaBackend` port** abstracts both. `infra/media/toolchain.py` resolves the binary
   in strict priority order (ADR §7.1) and records the resolved capability set:
   `NOVA_FFMPEG` → bundled EXE binary → `imageio-ffmpeg` static binary → system `PATH` →
   *CLI unavailable* (in which case CLI-only features degrade gracefully and the UI marks
   them as unavailable with a precise reason).
4. **Capability probing is cached** (`cache_index` + `settings.hw_capabilities`): encoders,
   decoders, hwaccels, filters and pixel formats are enumerated once per session and
   re-probed only on explicit user action. No feature may assume an encoder exists.
5. **Seeking is always keyframe-index aware** (ADR-0006 §5). `FrameSourcePool` keeps one
   decoder per asset with an LRU eviction policy, because opening a container is expensive
   (~1–10 ms) relative to a frame budget (16.7 ms).
6. **Colour management**: decode to a known colourspace, tag frames with
   `(space, range, primaries, transfer)`, and convert explicitly at the compositor boundary.
   Never let an implicit `swscale` default decide the look of the output.

## Consequences

**Positive**

* Works out of the box on a clean machine with no FFmpeg installed — the wheels carry
  everything.
* Frame-level Python control enables our own compositor, which is what makes preview and
  export provably identical (§7.2).
* CLI path gives access to the entire `libavfilter` catalogue without reimplementing it.
* Graceful degradation is explicit: a missing encoder produces `Err(NS-MEDIA-4002)` with a
  human-readable remedy, not a crash.

**Negative / accepted**

* Two code paths for overlapping work. Mitigated by conformance tests that run both backends
  over the same generated assets and assert identical output metadata
  (`tests/media/test_backend_conformance.py`).
* PyAV's API shifts between majors (we pin `>=13,<19` and adapt in `infra/media/pyav/`).
* PyAV wheels bundle their own FFmpeg, so the CLI binary and the library may differ in
  version. Mitigated by never assuming shared behaviour; each backend probes its own
  capabilities.
* Static `imageio-ffmpeg` builds may lack some encoders (no `libx265` in some builds);
  capability probing means the export UI only offers what actually exists.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| CLI-only (`subprocess` + rawvideo pipe) | One full frame copy per frame through a pipe, imprecise seeking, and no clean cancellation on Windows |
| PyAV-only | Cannot express complex filter graphs or some hwaccel export paths without enormous effort |
| GStreamer | Superb pipeline model, but a much heavier dependency to bundle portably on Windows and a smaller Python ecosystem for ML interop |
| OpenCV `VideoCapture` only | Insufficient codec/container control, no accurate seek, no muxing control; kept for image processing and analysis only |
| Requiring users to install FFmpeg | Violates the portable, offline-first, zero-admin requirement |
