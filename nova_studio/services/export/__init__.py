"""L3 feature — export: a project, and a project's captions, as files.

**Purpose.** Own the moment a project leaves Nova Studio — and the moment
somebody else's file arrives. Everything before this is authoring: a timeline, a
caption document, a look, a transcript. This feature turns those into the bytes
a platform ingests, and turns the bytes another tool wrote back into the values
the rest of the editor edits.

It owns nothing else: no encoder, no muxer, no job queue, all of which are
`services/render/` and the job subsystem's business.

The rule that shapes every module here is **an export is a pure function, and so
is an import**. No I/O: reading and writing bytes is a caller's job (ADR-0002),
so a conversion is testable on a machine with no disk, runnable twice, and
incapable of half-writing a file when it fails.

The second rule is **a format gets what it can carry, and no pretending**.
SubRip has no styling, so an SRT export is text and timings and nothing else;
inventing italics for it produces a file that renders differently in every
player that reads it. WebVTT knows about alignment and speakers, so a VTT export
writes them. A transcript in JSON carries the lot — words, characters, speakers,
confidence — because it is written and read by the domain itself.

**Folder structure.**

```
services/export/
├── __init__.py    this file: the feature's contract
├── codes.py       ExportErrorCode — NS-EXPORT-6001 and up
├── layers.py      layer_cues — which cues a file is written from
├── parse.py       what SubRip and WebVTT share when you read them
├── srt.py         to_srt · from_srt · srt_timestamp — SubRip
├── vtt.py         to_vtt · from_vtt · vtt_timestamp — WebVTT
└── transcript.py  to_transcript_json · from_transcript_json — the whole thing
```

**Backend / frontend.** The frontend never formats a timestamp and never splits
a cue block. It offers a format, a layer and a destination and gets back text it
can save or preview; it hands over a file's text and gets back a transcript.
That is what makes the export and import dialogs forms rather than second
implementations: one off-by-one in a millisecond field and every platform
rejects the file.

**State management.** Every function here takes a frozen document or a string and
returns text or a frozen value. There is no state, no cache of the last export,
and no handle to cancel: two exports of the same document give the same bytes,
which is what makes "the file I uploaded last week" reproducible from a project
that has been edited since.

**Functions.**

| Call | Answers |
| --- | --- |
| `to_srt(document, layer_id=…)` | "this layer, as a SubRip file" |
| `to_vtt(document, layer_id=…)` | "this layer, as a WebVTT file" |
| `from_srt(text)` / `from_vtt(text)` | "a file, as a transcript" |
| `to_transcript_json(transcript)` | "everything a transcript knows, as JSON" |
| `from_transcript_json(text)` | "a JSON file, as a transcript" |
| `layer_cues(document, layer_id)` | "which cues go into a file, and is this layer writable" |

**Class diagram.**

```
CaptionDocument ──to_srt──▶ str ──from_srt──▶ Transcript ──document_from_transcript──▶ CaptionDocument
               └─to_vtt──▶ str ──from_vtt──▶ Transcript ──┘
Transcript ──to_transcript_json──▶ str ──from_transcript_json──▶ Transcript
```

A `Transcript` sits in the middle on purpose: it is the shape every provider
returns (ADR-0009 §1), so an imported file goes through the *same* pipeline as a
recognition and a project cannot tell the two apart.

**Events.** None. An export that produced a file is a job's outcome, and the job
subsystem already reports those (ADR-0010 §3).

**Errors.** One enum, `NS-EXPORT-6001` and up, and every one is deterministic: a
layer that is not there, a layer with nothing in it, cues a player will
mishandle, a file that is not the format it claims to be, a cue that cannot be
read, JSON that is not a transcript. Nothing here is retried, because nothing
here fails transiently — a retry button on an empty layer is a button that
wastes the user's time. What they all have in common is the *place*: a cue
number, a line, a field. "Could not import" is not a sentence anyone can act on.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.
A document is the input and a transcript or a string is the output; nothing is
stored.

**Performance.** Linear in the number of cues, which is thousands at the outside
for a feature film. The one thing worth saying is that a file is built as a list
of strings and joined once, because string concatenation in a loop is quadratic
in a language with immutable strings — and because an export runs on a worker
the user is watching a progress bar for.

**Testing.** `tests/services/test_export_srt.py`, `test_export_vtt.py`,
`test_export_import.py` and `test_export_parse.py` read the bytes rather than the
intention: exact timestamps, exact separators, the comma in SubRip and the full
stop in WebVTT, escaping, round trips, and the refusals that fire before an
upload rather than after it. No fixtures, no disk, no golden files.

**Future expansion.**

* **More formats**: SSA/ASS, which is the only sidecar with real styling, and
  TTML/DFXP for broadcast delivery.
* **Burned-in captions**, which is not a sidecar at all but a render stage —
  and which will read the same keyframes `services/captions/bake.py` produced,
  so that a burned-in caption and a previewed one are the same picture.
* **A plain-text reader** (`.txt`), for a script someone typed with no timings
  at all, which is the one import that has to invent them and therefore the one
  that needs the most care.
"""

from __future__ import annotations

from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.layers import layer_cues, layer_of
from nova_studio.services.export.srt import from_srt, srt_timestamp, to_srt
from nova_studio.services.export.transcript import from_transcript_json, to_transcript_json
from nova_studio.services.export.vtt import from_vtt, to_vtt, vtt_timestamp

__all__ = [
    "ExportErrorCode",
    "from_srt",
    "from_transcript_json",
    "from_vtt",
    "layer_cues",
    "layer_of",
    "srt_timestamp",
    "to_srt",
    "to_transcript_json",
    "to_vtt",
    "vtt_timestamp",
]
