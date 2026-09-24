# ADR-0009 — Caption engine as an independent, provider-portable pipeline

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

The Caption Studio is the product's differentiator and is explicitly described as "the heart
of the software". It must support speech recognition, word *and* character timestamps,
speaker detection, translation, automatic line breaking, emoji, highlighting, smart
positioning with collision detection and safe areas, templates, per-word/per-letter styling,
multiple caption layers, and a dozen named animation modes (Karaoke, Story, TikTok, Netflix,
Podcast, Gaming, Wave, Bounce, Elastic, Physics…).

Three hazards must be designed out from day one:

1. **Model coupling.** ASR moves fast. Hard-coding faster-whisper means the product ages in
   months. We must be able to add Whisper-X-style forced alignment, a cloud provider, an
   NPU-backed local engine, or a user-supplied transcript without touching the pipeline.
2. **Destructive regeneration.** Users spend hours correcting a transcript. Re-running ASR
   must *merge* with human edits, not discard them.
3. **Style-as-code.** If "TikTok Bold" is a Python function, users and plugin authors cannot
   create templates, and the marketplace cannot exist.

## Decision

1. **`TranscriptionProvider` is a port.** Implementations: `FasterWhisperProvider`
   (default), `ExternalTranscriptProvider` (import SRT/VTT/JSON/txt with timings),
   `ManualTranscriptProvider` (typed transcript — also the deterministic test double), and
   any plugin-contributed provider. The provider returns a normalised `TranscriptGraph`,
   never a vendor-specific object. No other module may import `faster_whisper`.
2. **Three granularities are first-class in the model**: `CaptionSegment` → `CaptionWord` →
   `CaptionChar`. Character timings are derived by proportional splitting of a word's
   interval weighted by character class (vowels/long glyphs get more time) when the provider
   supplies only word timings, and used directly when it supplies character timings. Letter
   animation is therefore never a special case.
3. **The pipeline is a sequence of pure, individually replaceable stages**, each taking and
   returning immutable documents:
   `Extract → VAD → Transcribe → Refine → Diarise → Translate → Break → Emoji → Highlight
   → Position → Resolve → Bake`. Stages are registered in a `CaptionPipeline` with explicit
   enable flags and ordering; a plugin can insert a stage.
4. **Alignment safety is codified.** Audio is always converted by us to 16 kHz mono float32
   before reaching a provider. The alignment pass runs with `vad_filter=False` because VAD
   frame removal desynchronises the token↔time mapping in a meaningful fraction of real
   audio; VAD *is* used earlier, for silence trimming and region detection, and its offsets
   are applied to the resulting timings rather than being allowed to shift tokens. Output is
   validated: empty word lists, non-monotonic timestamps and out-of-range values raise
   `Err(NS-CAPTION-*)` with a remedy rather than silently producing broken captions.
5. **Styling is data.** A `CaptionTemplate` is a declarative, versioned JSON document
   describing typography (family, size, weight, tracking, leading, case), decoration
   (stroke, shadow, glow, gradient, outline, background plate, opacity), transform (anchor,
   position, safe-area rule, rotation), timing (min/max duration, padding, gap) and
   animation (per-word/per-letter specs with easing curves and stagger). The marketplace,
   the plugin contribution point and the preset picker all consume the same document type.
6. **Animation is baked into keyframes by an `AnimationBaker`** that evaluates an
   `AnimationSpec` against segment/word/char intervals and emits the same keyframe structures
   the rest of the editor uses. Consequently caption animation renders identically in
   preview and export, is inspectable in the Properties panel, and is editable by hand after
   baking. Modes (Karaoke, TikTok, Netflix, …) are *spec presets*, not code paths.
7. **Non-destructive regeneration.** A `CaptionDocument` has revisions. Human edits are
   stored as a delta overlay keyed by a stable alignment key (normalised text + nearest
   original word timing). Re-transcription produces a new base revision, and
   `CaptionMerge` re-applies surviving deltas by fuzzy key match, reporting what it could
   not re-attach for user review. Nothing is silently lost.
8. **Captions live on the timeline too.** On "commit", each segment becomes a clip on a
   caption track; the caption track is a normal track, so trimming, moving, ripple and
   keyframes all work with existing machinery. The `CaptionDocument` remains the authoring
   source of truth and the two are kept in sync by a dedicated reconciler inside one
   transaction.

## Consequences

**Positive**

* ASR engines are swappable; a better model next year is an adapter, not a rewrite.
* The entire pipeline after `Transcribe` is deterministic and pure → exhaustively unit
  testable **without any model weights**. This is decisive: it means the caption engine is
  verifiable in CI on a machine with no network and no GPU.
* Templates are user- and plugin-authorable, which makes the marketplace architecturally
  possible rather than aspirational.
* Human corrections survive regeneration — the single most common complaint about existing
  auto-caption tools.
* Caption animation inherits the editor's keyframe rendering, guaranteeing preview/export
  parity for free.

**Negative / accepted**

* The character-timing heuristic is an approximation when the provider gives only word
  timings; documented and exposed as a confidence value per character so the UI can show
  "estimated" timing. Providers that supply real character timings override it.
* Maintaining both a `CaptionDocument` and timeline clips costs a reconciler and a class of
  potential inconsistency. Mitigated by doing the reconciliation inside the same transaction
  and by round-trip tests.
* Merge-on-regeneration is fuzzy and can mis-attach a correction. Mitigated by always
  surfacing a review list of unmatched deltas instead of applying them silently.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Call faster-whisper directly from the caption service | Model lock-in; untestable without weights; violates ADR-0002 |
| Store only timeline clips, no caption document | Loses transcript-level structure (speakers, translation, alignment keys) needed for editing and merging |
| Store only the caption document, no timeline clips | Captions could not be trimmed/moved/keyframed with the rest of the editor; two editing paradigms |
| Style as Python code / per-template classes | Blocks user authoring, plugins and the marketplace |
| Snapshot-on-regenerate (discard previous edits) | Destroys hours of user correction; the exact failure mode we are differentiating against |
| Separate caption rendering engine | Would break preview/export parity (the classic subtitle "looks different after export" bug) |
