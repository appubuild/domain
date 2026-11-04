"""L3 feature — export: the project, as files other people's software reads.

**Purpose.** Own the moment a project leaves Nova Studio. Everything before
this is authoring: a timeline, a caption document, a look. This feature turns
those into the bytes a platform ingests — a SubRip sidecar, a WebVTT file — and
it owns nothing else: no encoder, no muxer, no job queue, all of which are
`services/render/` and the job subsystem's business.

The rule that shapes every module here is **an export is a pure function from a
document to text**. No I/O: writing the bytes is a caller's job (ADR-0002), so
an export can be tested on a machine with no disk, can be run twice without
side effects, and cannot half-write a file when it fails.

The second rule is **a format gets what it can carry, and no pretending**.
SubRip has no styling, so an SRT export is text and timings and nothing else;
inventing italics for it produces a file that renders differently in every
player that reads it. WebVTT knows about alignment and speakers, so a VTT
export writes them. Neither guesses about the other.

**Folder structure.**

```
services/export/
├── __init__.py   this file: the feature's contract
├── codes.py      ExportErrorCode — NS-EXPORT-6001 and up
├── layers.py     layer_cues — which cues a file is written from
├── srt.py        to_srt · srt_timestamp — SubRip
└── vtt.py        to_vtt · vtt_timestamp — WebVTT
```

**Backend / frontend.** The frontend never formats a timestamp. It offers a
format, a layer and a destination, and gets back text it can save or preview.
That is what makes the export dialog a form rather than a second
implementation: one off-by-one in a millisecond field and every platform
rejects the file.

**State management.** Every function here takes a frozen document and returns
text. There is no state, no cache of the last export, and no handle to cancel:
two exports of the same document give the same bytes, which is what makes "the
file I uploaded last week" reproducible from a project that has been edited
since.

**Functions.**

| Call | Answers |
| --- | --- |
| `to_srt(document, layer_id=…)` | "this layer, as a SubRip file" |
| `to_vtt(document, layer_id=…)` | "this layer, as a WebVTT file" |
| `srt_timestamp(ms)` / `vtt_timestamp(ms)` | "how this format writes a moment" |
| `layer_cues(document, layer_id)` | "which cues go into a file, and is this layer writable" |

**Events.** None. An export that produced a file is a job's outcome, and the
job subsystem already reports those (ADR-0010 §3).

**Errors.** One enum, `NS-EXPORT-6001` and up, and all four are deterministic:
a layer that is not there, a layer with nothing in it, cues a player will
mishandle, a format this build cannot write. Nothing here is retried, because
nothing here fails transiently — a retry button on an empty layer is a button
that wastes the user's time.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.
A document is the input; nothing is stored.

**Performance.** Linear in the number of cues, which is thousands at the
outside for a feature film. The one thing worth saying is that a file is built
as a list of strings and joined once, because string concatenation in a loop is
quadratic in a language with immutable strings — and because an export runs on
a worker the user is watching a progress bar for.

**Testing.** `tests/services/test_export_srt.py` and `test_export_vtt.py` read
the bytes, not the intention: exact timestamps, exact separators, the comma in
SubRip and the full stop in WebVTT, escaping, and the refusal to write a layer
that a player will mishandle. No fixtures, no disk, no golden files.

**Future expansion.**

* **Import**, the other half: SRT, VTT and JSON into a `CaptionDocument`, which
  is what feeds `ExternalTranscriptProvider` (ADR-0009 §1) and what makes a
  file someone else captioned editable here.
* **More formats**: SSA/ASS, which is the only sidecar with real styling, and
  TTML/DFXP for broadcast delivery.
* **Burned-in captions**, which is not a sidecar at all but a render stage —
  and which will read the same keyframes `services/captions/bake.py` produced,
  so that a burned-in caption and a previewed one are the same picture.
"""

from __future__ import annotations

from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.layers import layer_cues, layer_of
from nova_studio.services.export.srt import srt_timestamp, to_srt
from nova_studio.services.export.vtt import to_vtt, vtt_timestamp

__all__ = [
    "ExportErrorCode",
    "layer_cues",
    "layer_of",
    "srt_timestamp",
    "to_srt",
    "to_vtt",
    "vtt_timestamp",
]
