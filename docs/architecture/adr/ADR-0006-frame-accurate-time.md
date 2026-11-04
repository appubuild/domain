# ADR-0006 — Integer frame timebase as the canonical time representation

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

"Frame accurate" is a stated product requirement, and it is the requirement NLEs most often
violate silently. Two failure modes dominate real editors:

1. **Float drift.** Storing clip positions in seconds as `float` means `0.1 + 0.2 != 0.3`.
   After hundreds of ripple edits, cumulative error shifts a clip by a frame — and the user
   sees a one-frame black flash or an audio/video lip-sync drift that grows down the
   timeline.
2. **Rational-time confusion.** FFmpeg exposes `time_base` rationals (e.g. `1/15360`), and
   container timestamps, stream timestamps, edit-list offsets and display rates can all
   differ. Naively multiplying by `float(time_base)` loses exactness for rates like
   29.97 / 23.976 (30000/1001).

We verified against PyAV 18.1 on a synthetic 30 fps H.264 asset that
`stream.time_base == 1/15360` while `average_rate == 30`, and that
`container.seek(int(1.5 * av.time_base))` lands on the **keyframe at t = 2.0 s** for a
GOP of 30 — i.e. seeking alone is not frame accurate and must be followed by exact stepping.
Both findings shaped this decision.

## Decision

1. **The canonical time unit is the frame at the project's edit rate.** All timeline
   quantities — clip start, clip length, in/out points, keyframe time, marker position,
   caption segment/word/character timing — are `int` frames.
2. A single value object owns conversions: `domain/temporal.py`.
   * `Timebase(num: int, den: int)` — exact rational, with the standard NTSC rates as named
     constants (`23.976 = 24000/1001`, `29.97 = 30000/1001`, `59.94 = 60000/1001`).
   * `FrameTime(frames: int, timebase: Timebase)` — the timeline unit.
   * `Timecode` — SMPTE representation, **drop-frame aware** for 29.97/59.94, with
     `hh:mm:ss[:;]ff` parsing and formatting.
   * `SampleTime(samples: int, sample_rate: int)` — the audio unit, kept separate so audio
     never rounds to video frames.
   * Conversions use **integer arithmetic only** (`(frames * den) // num` style with explicit,
     documented rounding modes). Floats appear only in the final human-facing display and in
     DSP, never in stored state.
3. **Rounding is explicit and named.** Every conversion takes a `Rounding` parameter
   (`FLOOR`, `CEIL`, `NEAREST`, `NEAREST_EVEN`) with a project-wide default of `NEAREST` for
   display and `FLOOR` for cut boundaries (a cut must include the whole frame it starts on).
   Implicit rounding is a lint-level offence in review.
4. **Asset→timeline time mapping** is stored as an exact rational `speed` plus an
   integer `source_start_frame`, so retiming never accumulates error: the mapping is computed
   from the original integers on demand.
5. **Seeking is a two-step operation, always.** `DecodeStage` seeks to the last keyframe ≤
   target using the asset's **keyframe index** (built once per asset and cached in
   `media_cache`), then decodes forward discarding frames until the exact target. No code
   path may assume a seek returns the requested frame.
6. **Audio/video alignment** is derived, never stored: given a timeline frame, the audio
   position is computed via `Timebase` → `SampleTime` conversion with an explicit rounding
   mode, and the audio engine resamples around that anchor.

## Consequences

**Positive**

* Zero cumulative drift under any sequence of edits; ripple and roll edits are exact integer
  arithmetic.
* Drop-frame timecode is correct for broadcast rates (a frequent source of shipped bugs).
* The keyframe index makes frame-accurate random access fast (typically ≤ 1 extra decode).
* Deterministic behaviour makes golden-frame tests possible and meaningful.

**Negative / accepted**

* Variable-frame-rate (VFR) sources — phone footage — do not map cleanly onto a fixed
  timebase. Handled explicitly: on import, a VFR asset is flagged and the user is offered
  "conform to project rate" (transcode to CFR proxy) or "keep VFR" (per-frame timestamp
  table stored in `asset_frame_index`, and the decode stage resolves time → frame through
  it rather than by arithmetic).
* Speed ramps need sub-frame precision for smoothness. Handled by evaluating the ramp curve
  in float *within* the mapping function while the stored control points remain integer
  frames — the curve is a pure function, so nothing accumulates.
* Developers must learn the value objects. Mitigated by making the raw `int`/`float` forms
  un-constructible outside `domain/temporal.py` review-wise and by extensive docstrings.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Seconds as `float` everywhere | Guaranteed drift; the single most common NLE defect |
| Seconds as `Decimal` | Exact for base-10 but wrong for 30000/1001 rates, and 10–50× slower in hot loops |
| FFmpeg rationals exposed throughout the codebase | Leaks a C-library concept into domain logic; hard to reason about |
| Microsecond integers | Better than floats, but still requires rounding at frame boundaries and hides off-by-one errors at cut points |
