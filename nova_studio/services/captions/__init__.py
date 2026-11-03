"""L3 feature — captions: from a stream of words to cues a viewer can read.

**Purpose.** Own the two decisions that make captions watchable: **which words
the viewer reads together** (`segmentation.py`) and **what a house style does to
them** (`styles.py`). `domain/captions.py` owns the document — cues, words,
characters, layers, revisions, deltas; `domain/asr.py` owns what a provider
returns; `ports/asr.py` owns how audio becomes a transcript. This layer owns the
opinions: how long a cue stays up, how fast it may be read, where it sits, and
what a "TikTok caption" means.

**Folder structure.**

```
services/captions/
├── __init__.py       this file: the feature's contract
├── segmentation.py   CueRules · build_cues — the breaker
└── styles.py         CaptionTemplate · CaptionLook · apply_look — the presets
```

**Backend / frontend.** The frontend never breaks a cue or invents a style. It
picks a template, and the panel shows the cues that came back plus the reading
rate each one implies. `CueRules` is the settings panel: every field is a thing
an editor argues about, so every field is data rather than a constant — a
podcast house style and a TikTok one differ by one object, not by a second code
path.

**State management.** Both modules are pure functions over frozen values. A
`CueRules` can be shipped in a project file, a plugin manifest or a preset; a
`CaptionLook` is a frozen value with three answers and no behaviour. Nothing
here holds a document, a decoder or a clock.

**Functions.**

| Call | Answers |
| --- | --- |
| `build_cues(transcript, rules)` | "which words go together, and when" |
| `look_for(template)` | "what does this house style mean" |
| `CaptionLook.rules()` / `.position()` / `.overrides()` | "how to break / where to sit / how it looks" |
| `apply_look(cues, look)` | "these cues, wearing this look" |

**Events.** None yet. A transcription is a `Job` (ADR-0010) and reports
`job.*`; the cue builder is a stage inside it.

**Error handling.** Both modules are pure and total over their inputs: an empty
transcript builds no cues, and a cue with no word timings gets them derived and
marked estimated rather than failing. They raise `NovaInvariantError` for a
nonsensical rule — zero characters a line, a non-positive reading rate — because
those are bugs in whoever wrote the preset. Provider failures are
`ports/asr.py`'s codes (`NS-ASR-*`), never this feature's.

**Caching.** Cues are derived data and are recomputed on every re-transcription —
cheaply, because the builder is a single pass over words. What survives is
*human* work: ADR-0009 §7 files every manual correction under an
`alignment_key` (normalised text plus a bucketed start time), so a
re-transcription that moves a cue 300 ms re-attaches the correction instead of
orphaning it.

**Performance.** One pass over the words, O(n) in the transcript, with a
grapheme count per candidate cue. Character timings come from the domain's
weighted proportional split, which is why karaoke is available on every provider
and not only on those that ship character timings.

**Testing.** `tests/services/test_captions_segmentation.py` pins the breaker:
the character, duration and reading-rate caps, silence and punctuation breaks,
the minimum on-screen time that never overlaps the next cue, derived timings for
a provider that gave none, and that no word is ever dropped.
`tests/services/test_captions_styles.py` pins the presets and the one real trap
in applying them — that changing a cue's case rebuilds its words, because a
word's characters must join to make the word.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **The pipeline** (`pipeline.py`): ASR → VAD → word alignment → diarisation →
  cues → merge with surviving human edits. The ports exist
  (`ports/asr.py`) and the merge outcome exists (`CaptionMergeOutcome`); the
  orchestration is the next slice of this feature, and it is a `Job`.
* **Translation layers**, which are a second `CaptionLayer` of the same
  document, not a second document (ADR-0009 §8).
* **Smart positioning and collision resolution** built on `CaptionRect.overlaps`,
  once face detection lands in `services/ai/`.
* **Import/export** of SRT, VTT and JSON, in `services/export/`.
"""

from __future__ import annotations

from nova_studio.services.captions.segmentation import (
    DEFAULT_CUE_RULES,
    CueRules,
    build_cues,
)
from nova_studio.services.captions.styles import (
    DEFAULT_TEMPLATE,
    LOOKS,
    Backdrop,
    CaptionLook,
    CaptionTemplate,
    TextCase,
    WordAnimation,
    apply_look,
    look_for,
)

__all__ = [
    "DEFAULT_CUE_RULES",
    "DEFAULT_TEMPLATE",
    "LOOKS",
    "Backdrop",
    "CaptionLook",
    "CaptionTemplate",
    "CueRules",
    "TextCase",
    "WordAnimation",
    "apply_look",
    "build_cues",
    "look_for",
]
