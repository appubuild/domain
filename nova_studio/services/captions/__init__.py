"""L3 feature — captions: the engine behind the AI Caption Studio (ADR-0009).

**Purpose.** Own everything that happens to captions *after* the words exist.
`domain/asr.py` owns what a transcript is; `ports/asr.py` owns how speech
becomes one; this feature owns how a transcript becomes cues, how those cues are
broken, placed, styled and animated, and how a document is reconciled onto the
timeline.

The spine is `CaptionPipeline`: twelve named stages —
`Extract → VAD → Transcribe → Refine → Diarise → Translate → Break → Emoji →
Highlight → Position → Resolve → Bake` — each a pure function from one immutable
document to the next. That is the decision that makes the engine verifiable in
CI on a machine with no network, no GPU and no model weights, and the decision
that lets a plugin insert a stage without touching any other.

**Folder structure.**

```
services/captions/
├── __init__.py   this file: the feature's contract
├── codes.py      CaptionErrorCode — NS-CAPTION-4010 and up
├── pipeline.py   CaptionPipeline · StageContext · stage_failed
├── timing.py     held_until · chars_per_second — the two shared rules
├── build.py      transcript → CaptionDocument (ADR-0009 §1, §2, §4)
└── cues.py       the Break stage: words → readable cues
```

**Backend / frontend.** One call per intent. The Caption Studio panel builds a
document from a transcript, runs a pipeline, and commits the result; every call
returns a `Result`, so the UI renders a remedy ("download the base model —
145 MB") rather than a traceback.

**State management.** Every stage is a frozen value, and every document is
immutable, so a pipeline can be handed to a worker without anyone worrying
about a plugin inserting a stage mid-run. Nothing here holds a model, a file
handle or a clock.

**Functions.**

| Call | Answers |
| --- | --- |
| `document_from_transcript(t)` | "what cues does this transcript say" |
| `CaptionPipeline.run(doc, ctx)` | "run every enabled stage, then check the result" |
| `CueBreaker().apply(doc, ctx)` | "break these words into readable cues" |
| `held_until(start, end, …)` | "when should this cue stop being shown" |
| `chars_per_second(text, s, e)` | "can this be read that fast" |

**Events.** None yet. A generation is a `Job` (ADR-0010) and reports `job.*`;
the stages themselves publish nothing, because they are values a caller runs
rather than tasks a scheduler owns.

**Error handling.** Two bands, split at the seam ADR-0009 §1 draws:
`NS-CAPTION-4001`–`4006` come from `ports/asr.py` and describe *speech
recognition* — unreadable audio, missing weights, a transcript whose timings
cannot be trusted. `CaptionErrorCode` (`4010`+) describes *caption authoring* —
a stage that failed, a result no renderer may be given, a template that does not
describe a style. Caller bugs — a duplicate stage name, a frame of zero size —
raise `NovaInvariantError` instead of being returned, because they cannot be
fixed by retrying.

**Caching.** Nothing is cached yet, and that is deliberate: a stage is pure, so
a cache is a decision for the caller that knows how long a document lives.

**Performance.** Every stage is a single pass over the cues, and every document
is immutable, so a run allocates one document per stage rather than mutating in
place. `Break` is O(words × fill) in the worst case; the fill is capped by the
line budget, which is a constant.

**Testing.** `tests/services/test_captions_pipeline.py` pins ordering, skipping
and attribution; `test_captions_break.py` pins the four constraints and two
preferences; `test_captions_build.py` pins the transcript seam. No model, no
audio, no clock — which is the point of ADR-0009 §3.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **The remaining stages** — `refine`, `emoji`, `highlight`, `position`,
  `resolve`, `bake` — each as its own module, each with its own tests.
* **The runner**, which drives the I/O stages (`extract`, `vad`, `transcribe`,
  `diarise`, `translate`) through `ports/asr.py` and then runs the pure half.
* **Non-destructive regeneration** (§7) and **the timeline reconciler** (§8).
"""

from __future__ import annotations

from nova_studio.services.captions.build import (
    document_from_transcript,
    segments_from_transcript,
)
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.cues import (
    DEFAULT_MAX_DURATION_MS,
    DEFAULT_MIN_DURATION_MS,
    MIN_WORDS_BEFORE_BACKOFF,
    CueBreaker,
)
from nova_studio.services.captions.pipeline import (
    CaptionPipeline,
    StageContext,
    stage_failed,
)
from nova_studio.services.captions.timing import chars_per_second, held_until

__all__ = [
    "DEFAULT_MAX_DURATION_MS",
    "DEFAULT_MIN_DURATION_MS",
    "MIN_WORDS_BEFORE_BACKOFF",
    "CaptionErrorCode",
    "CaptionPipeline",
    "CueBreaker",
    "StageContext",
    "chars_per_second",
    "document_from_transcript",
    "held_until",
    "segments_from_transcript",
    "stage_failed",
]
