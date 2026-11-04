"""L3 feature — captions: from a stream of words to cues a viewer can read.

**Purpose.** Own everything that happens to a caption *after* the words exist.
`domain/captions.py` owns what a caption document is; `domain/asr.py` owns what
a provider returns; `ports/asr.py` owns how audio becomes a transcript. This
layer owns the opinions: **which words a viewer reads together**, **how long a
cue stays up**, **where it sits**, **what a house style does to it**, and **the
order in which all of that happens**.

The order is `CaptionPipeline` — twelve named stages,
`Extract → VAD → Transcribe → Refine → Diarise → Translate → Break → Emoji →
Highlight → Position → Resolve → Bake` (ADR-0009 §3), each a pure function from
one immutable document to the next. That is what makes the engine verifiable in
CI on a machine with no model weights, and what lets a plugin insert a stage
without touching any other.

**Folder structure.**

```
services/captions/
├── __init__.py       this file: the feature's contract
├── codes.py          CaptionErrorCode — NS-CAPTION-4010 and up
├── pipeline.py       CaptionPipeline · StageContext · stage_failed
├── timing.py         chars_per_second · time_to_read · held_until
├── segmentation.py   CueRules · cue_spans · build_cues — the breaker
├── build.py          transcript → CaptionDocument (ADR-0009 §1, §2, §4)
├── merge.py          regeneration: a new transcription that keeps the edits
├── positioning.py    CuePlacer · cue_box — where a cue sits, and what moves it
├── cues.py           CueBreaker — the Break stage
└── styles.py         CaptionTemplate · CaptionLook · apply_look · StyleStage
```

**Backend / frontend.** The frontend never breaks a cue or invents a style. It
picks a template, and the panel shows the cues that came back plus the reading
rate each one implies. `CueRules` *is* the settings panel: every field is a
thing an editor argues about, so every field is data rather than a constant — a
podcast house style and a TikTok one differ by one object, not by a second code
path.

**State management.** Every module here is a pure function over frozen values. A
`CueRules` can be shipped in a project file, a plugin manifest or a preset; a
`CaptionPipeline` can be handed to a worker, because nothing in it holds a
document, a decoder or a clock.

**Functions.**

| Call | Answers |
| --- | --- |
| `document_from_transcript(t, …)` | "what cues does this transcript say, as a document" |
| `build_cues(transcript, rules)` | "which words go together, and when" |
| `cue_spans(words, rules)` | the same, over words of any kind — the reusable core |
| `CueBreaker().apply(doc, ctx)` | "re-break this document's cues" |
| `CuePlacer().apply(doc, ctx)` | "put these cues where they do not clash" |
| `cue_box(cue, ctx)` | "which pixels does this cue cover" |
| `CaptionPipeline.run(doc, ctx)` | "run every enabled stage, then check the result" |
| `look_for(template)` / `apply_look(cues, look)` | "what does this house style mean / these cues, wearing it" |
| `held_until(…)` / `time_to_read(…)` / `chars_per_second(…)` | the timing arithmetic |

**Events.** None yet. A transcription is a `Job` (ADR-0010) and reports `job.*`;
the stages themselves publish nothing, because they are values a caller runs
rather than tasks a scheduler owns.

**Error handling.** Two bands, split at the seam ADR-0009 §1 draws.
`NS-CAPTION-4001`–`4006` come from `ports/asr.py` and describe *speech
recognition* — unreadable audio, missing weights, a transcript whose timings
cannot be trusted; `document_from_transcript` returns those rather than a
document built from something unsound. `CaptionErrorCode` (`4010`+) describes
*caption authoring* — a stage that failed, a result no renderer may be given.
Caller bugs — a duplicate stage name, a rule with no characters a line — raise
`NovaInvariantError`, because they cannot be fixed by retrying.

**Caching.** Cues are derived data and are recomputed on every re-transcription
— cheaply, because the builder is a single pass over words. What survives is
*human* work: ADR-0009 §7 files every manual correction under an
`alignment_key` (normalised text plus a bucketed start time), so a
re-transcription that moves a cue 300 ms re-attaches the correction instead of
orphaning it.

**Performance.** One pass over the words, O(n) in the transcript, with a
grapheme count per candidate cue. Character timings come from the domain's
weighted proportional split, which is why karaoke is available on every provider
and not only on those that ship character timings.

**Testing.** `tests/services/test_captions_pipeline.py` pins ordering, skipping
and attribution; `test_captions_segmentation.py` pins the breaker — the
character, duration and reading-rate caps, silence, punctuation and speaker
breaks, the hold that never overlaps the next cue, derived timings for a
provider that gave none, and that no word is ever dropped.
`tests/services/test_captions_break.py` pins the same rules as a pipeline
stage — locked cues untouched, word objects carried rather than rebuilt.
`test_captions_positioning.py` pins placement: the safe area as a hard wall, a
cue moved off a protected lower third, a locked cue that is an obstacle for
everything else, two layers on screen at once, and the same fractions at twice
the frame size. `test_captions_build.py` pins the transcript seam,
`test_captions_merge.py` the
regeneration — a correction re-attached, a locked line kept, an unmatched edit
reported rather than guessed at — and `test_captions_styles.py` the presets. No
model, no audio, no clock: that is the point of ADR-0009 §3.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **The remaining stages** — `refine`, `emoji`, `highlight`, `bake` — each as
  its own module, each with its own tests. `Position` and `Resolve` are built
  (`positioning.py`).
* **The timeline reconciler** (ADR-0009 §8), which commits a document to caption
  clips in one transaction.
* **The runner**, which drives the I/O stages (`extract`, `vad`, `transcribe`,
  `diarise`, `translate`) through `ports/asr.py` and then runs the pure half as
  a `Job`.
* **Translation layers**, which are a second `CaptionLayer` of the same
  document, not a second document.
* **Import/export** of SRT, VTT and JSON, in `services/export/`.
"""

from __future__ import annotations

from nova_studio.services.captions.build import (
    document_from_transcript,
    segments_from_transcript,
)
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.commit import (
    DEFAULT_CAPTION_TRACK_ID,
    CaptionCommit,
    caption_clip,
    clip_id_for,
    commit_document,
    commit_layer,
)
from nova_studio.services.captions.cues import CueBreaker
from nova_studio.services.captions.merge import (
    CaptionRegeneration,
    apply_edit,
    record_deletion,
    record_insertion,
    record_style_edit,
    record_text_edit,
    record_timing_edit,
    regenerate,
)
from nova_studio.services.captions.pipeline import (
    CaptionPipeline,
    StageContext,
    stage_failed,
)
from nova_studio.services.captions.positioning import (
    DEFAULT_CHAR_ASPECT,
    DEFAULT_MAX_SHIFT_LINES,
    DEFAULT_PADDING_FRACTION,
    CueBox,
    CuePlacer,
    cue_box,
)
from nova_studio.services.captions.refine import (
    DEFAULT_FILLERS,
    DEFAULT_REFINE_RULES,
    FILLERS_BY_LANGUAGE,
    Refiner,
    RefineRules,
    is_filler,
    refine_segment,
    refine_words,
    tidy_text,
)
from nova_studio.services.captions.segmentation import (
    DEFAULT_CUE_RULES,
    CueRules,
    CueSpan,
    build_cues,
    cue_spans,
)
from nova_studio.services.captions.styles import (
    DEFAULT_TEMPLATE,
    LOOKS,
    Backdrop,
    CaptionLook,
    CaptionTemplate,
    StyleStage,
    TextCase,
    WordAnimation,
    apply_look,
    look_for,
)
from nova_studio.services.captions.timing import (
    chars_per_second,
    held_until,
    time_to_read,
)

__all__ = [
    "DEFAULT_CAPTION_TRACK_ID",
    "DEFAULT_CHAR_ASPECT",
    "DEFAULT_CUE_RULES",
    "DEFAULT_FILLERS",
    "DEFAULT_MAX_SHIFT_LINES",
    "DEFAULT_PADDING_FRACTION",
    "DEFAULT_REFINE_RULES",
    "DEFAULT_TEMPLATE",
    "FILLERS_BY_LANGUAGE",
    "LOOKS",
    "Backdrop",
    "CaptionCommit",
    "CaptionErrorCode",
    "CaptionLook",
    "CaptionPipeline",
    "CaptionRegeneration",
    "CaptionTemplate",
    "CueBreaker",
    "CueRules",
    "CueSpan",
    "RefineRules",
    "Refiner",
    "StageContext",
    "StyleStage",
    "TextCase",
    "WordAnimation",
    "apply_edit",
    "apply_look",
    "build_cues",
    "caption_clip",
    "chars_per_second",
    "clip_id_for",
    "commit_document",
    "commit_layer",
    "cue_box",
    "cue_spans",
    "document_from_transcript",
    "held_until",
    "is_filler",
    "look_for",
    "record_deletion",
    "record_insertion",
    "record_style_edit",
    "record_text_edit",
    "record_timing_edit",
    "refine_segment",
    "refine_words",
    "regenerate",
    "segments_from_transcript",
    "stage_failed",
    "time_to_read",
]
