# The `.nova` project file format

**Status:** Normative for ADR-0015 · **Owner:** Architecture Group · **Last reviewed:** 2026-11-02

This is the specification ADR-0015 points at. It is the contract between
`domain/` (which decides *what* a project is) and `infra/persistence` (which
decides *how those bytes are written and found again*). Anything a `.nova` file
may contain is described here; anything not described here is not part of the
format, and a reader may ignore it.

Normative words: **must**, **must not**, **may**. A reader that refuses a file
this specification says it must accept is wrong; a reader that accepts a file
this specification says it must refuse is also wrong.

---

## 1. What the format has to survive

| Requirement | Consequence here |
| --- | --- |
| Ten years of format evolution | `manifest.format_version` is an integer and migrations are an ordered chain (§7). |
| Copyable by hand, attachable to a bug report | One file, openable by any zip tool, plain-text documents inside. |
| Inspectable with no proprietary tooling | Canonical JSON (§4); a support engineer can `unzip -p project.nova timeline/document.json`. |
| Recoverable after a crash | Atomic writes plus an append-only journal (§8). |
| Damaged media must not lose the edit | Missing media is a *state*, never a parse error (§6.3). |
| Byte-level diffing and stable checksums | Canonical JSON: two saves of an unchanged project are identical (§4). |

Non-goals: the file is **not** a media container (originals are referenced, never
moved), **not** a cache (proxies and thumbnails are optional and disposable),
and **not** an undo stack (that is `domain/persistence`'s journal, outside the
file).

---

## 2. The container

A `.nova` file is a **ZIP archive**.

* Deflate for JSON and text entries. Media entries (proxies, thumbnails,
  `preview.jpg`) **may** be `STORED` — they are already compressed, and the
  bytes must be readable by a thumbnailer that mmaps the entry.
* Entry names are **relative POSIX paths**. A reader must refuse an archive
  whose entry names are absolute, contain a `..` segment, contain a backslash,
  contain a drive letter, or are empty. `domain/persistence.is_valid_document_name`
  is the predicate; every name this format defines passes it.
* A reader **must not** follow entry names when extracting. Names are addresses
  inside the archive, not paths on the user's disk.
* Entry order is not significant. A writer nevertheless writes the entries in
  the order of §3 so that `unzip -l` reads top-down.
* Duplicate entry names make the file invalid.

---

## 3. Layout

```
project.nova  (ZIP)
├── manifest.json              identity + format_version            required
├── project.json               settings, media bin, bindings        required
├── timeline/
│   ├── document.json          THE authoritative timeline graph     required
│   └── revisions/             bounded checkpoints (default 5)      optional
│       └── 000000.json …
├── captions/
│   ├── <doc_id>.json          one CaptionDocument per id           optional
│   └── sidecar/*.srt|*.vtt    user-exported copies, never read     optional
├── templates/                 caption/effect/transition templates  optional
├── fonts/                     embeddable fonts + reference list     optional
├── media/
│   ├── index.json             asset_id → location, hash, probe     optional
│   └── thumb/<asset_id>.jpg   preview posters                      optional
├── preview.jpg                poster for the project manager       optional
├── plugins.json               plugin ids and versions in use       optional
└── checksum.json              per-entry SHA-256                    optional
```

Only `manifest.json`, `project.json` and `timeline/document.json` are required.
A `.nova` file containing nothing else is a valid project with an empty bin, an
empty timeline and no captions.

The entry names are not string literals scattered through the writer; they are
constants in `domain/persistence` (`MANIFEST_DOCUMENT`, `PROJECT_DOCUMENT`,
`TIMELINE_DOCUMENT`, `MEDIA_INDEX_DOCUMENT`, `CHECKSUM_DOCUMENT`,
`PLUGIN_DOCUMENT`, `PREVIEW_IMAGE`) and the prefixes `REVISION_PREFIX`,
`CAPTION_PREFIX`, `TEMPLATE_PREFIX`, `FONT_PREFIX`, `MEDIA_PREFIX`, so that a
rename is one edit and a typo is impossible at the call site.

---

## 4. Canonical JSON

Every `.json` entry is **canonical JSON**:

1. Keys sorted lexicographically by UTF-8 byte order, at every depth.
2. No insignificant whitespace: `,` and `:` with no following space.
3. UTF-8, no BOM, `LF` line endings, a trailing `\n` on the document.
4. Integers are written as integers. Nothing in a project document is a float
   that could round-trip as `30.000000000000004`.
5. No `NaN`, `Infinity` or `-Infinity` — JSON has no such literals and a writer
   that emits them has written an unreadable file. Bounds that are "infinite"
   are *absent* in the domain model, not sentinels.
6. `null` is written only where a domain field is genuinely optional.

Two consequences worth the discipline: a checksum over a document is stable
across saves and across machines, and `diff` between two revisions of a project
shows the edit and nothing else.

Rational-time values are written as two-element integer arrays (`[30, 1]`), not
as floats and not as strings: `30000/1001` is exact as `[30000, 1001]` and is
not exact as `29.97002997002997`.

---

## 5. Entries

### 5.1 `manifest.json` — required

Produced by `domain/persistence.ProjectManifest`.

```json
{"app_version":"1.0.0","created_ms":1767222000000,"format_version":1,
 "modified_ms":1767225600000,"project_id":"01J8ZZ9K3M4N5P6Q7R8S9T0V1W"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `project_id` | string | ULID; stable for the life of the project, across renames and saves. |
| `format_version` | int ≥ 1 | The number §7 turns into a decision. |
| `app_version` | string | Which build wrote the file. Diagnostic, never parsed. |
| `created_ms` / `modified_ms` | int | Epoch milliseconds. `modified_ms >= created_ms`. |

### 5.2 `project.json` — required

Produced by `domain/project.Project.to_documents()`: everything the project holds
**except** the timeline graph and the caption documents, which are their own
entries. The split is made in the domain, not in the adapter, so that the
split itself is unit-tested (`PROJECT_DOCUMENT_FIELDS`).

```json
{
  "assets": [
    {"asset_id":"01J8ZZ9K3M4N5P6Q7R8S9T0V2X","content_hash":null,
     "kind":"video","link_state":"linked","path":"D:/Media/clip_001.mp4","probe":null}
  ],
  "blends": [],
  "effects": [],
  "masks": [],
  "metadata": {"author":"","created_ms":0,"description":"","modified_ms":0,"tags":[]},
  "name": "Launch teaser",
  "project_id": "01J8ZZ9K3M4N5P6Q7R8S9T0V1W",
  "settings": {
    "channels": 2,
    "frame_size": {"height":1080,"width":1920},
    "sample_rate": 48000,
    "use_proxies": true,
    "working_colour_space": 1
  },
  "transforms": []
}
```

* **`settings`** is the render target, not the preview: `frame_size` is the frame
  the compositor builds, in composition pixels from the centre.
  `working_colour_space` is an integer SMPEG/ffmpeg colour-space code written as
  a number, never a name, so a rename upstream cannot invalidate a file.
* **`effects` / `transforms` / `masks` / `blends`** are the *bindings*: what
  decorates what, keyed by the id of the clip or track it decorates. They are
  stored here rather than on the clip so that deleting a clip is one pruning
  pass (ARCHITECTURE §7.10). An absent binding means "the user has never touched
  this", which is why an empty chain, an identity transform, an empty mask list
  and `NORMAL` blend are all *removed* rather than written.
* **`assets`** is the media bin. `path` is recorded, never resolved, at parse
  time; `link_state` is `"linked"` or `"missing"`.

### 5.3 `timeline/document.json` — required

Produced by `domain/timeline.Timeline.to_wire()`. **This is the single source of
truth for the edit** (ADR-0015 rule 1): tracks, clips, transitions and markers.
The session database, if any, is a derived index rebuilt from it on open.

```json
{
  "markers": [],
  "timebase": [30, 1],
  "tracks": [
    {"clips":[
       {"asset_id":"01J8ZZ9K3M4N5P6Q7R8S9T0V2X","clip_id":"c1","enabled":true,
        "in_frame":0,"kind":"video","name":"","out_frame":180,"speed":"1/1",
        "start_frame":0}],
     "hidden":false,"index":0,"kind":"video","locked":false,"muted":false,
     "name":"","track_id":"v1","transitions":[]}
  ]
}
```

* `timebase` is the project's frame rate and lives **here only**. No other entry
  may repeat it; a reader that finds a second copy must treat this one as
  authoritative (ARCHITECTURE §7.10).
* Positions are **integer frames**, never seconds and never floats (ADR-0006).
* `speed` is a rational written as `"num/den"`; `1/1` is normal, `-1/1` is
  reversed.
* A clip whose `kind` is generated (`solid`, `text`, `adjustment`, `caption`)
  has an empty `asset_id`, and that is valid.

### 5.4 `timeline/revisions/<NNNNNN>.json` — optional

Checkpoints of `timeline/document.json`, named by
`domain/persistence.revision_document(sequence)`: six-digit, zero-padded, so
that lexical order equals chronological order and `unzip -l` reads as history.

The set is **bounded** — `CheckpointPolicy.max_revisions`, default **5** — and
`revisions_to_prune` returns the oldest beyond the bound, oldest-first, which is
the order a caller deletes in. A project that has been open for eight hours is
not eight hours large. Pruning to zero is refused: crash recovery needs
somewhere to replay onto.

### 5.5 `captions/<doc_id>.json` — optional

One entry per caption document, produced by `CaptionDocument.to_wire()` and
filed under `captions/<doc_id>.json`.

The `<doc_id>` is validated **where it is accepted**, not where it is written:
`CaptionDocumentRef` checks it against `is_valid_document_name`. The `.nova`
file is a ZIP, so an unvalidated id is the zip-slip attack, and the rule belongs
at the door. Ids are bare names — no `/`, no `\` — and the resulting entry name
must itself be a safe relative POSIX path.

`captions/sidecar/*.srt|*.vtt` are user-exported copies. They are written for
convenience and **never read as truth**; a reader must ignore them entirely.

### 5.6 `templates/`, `fonts/` — optional

Caption, effect and transition templates in use, and fonts whose licence permits
embedding. A font that may not be embedded is recorded as a *reference* (family,
weight, style) rather than as bytes, so a shared project degrades to a
substitution instead of a licence violation. Population of these entries belongs
to the caption and template stages; the directories are reserved now.

### 5.7 `media/index.json` — optional

The only entry allowed to contain **machine-specific absolute paths**. It maps
`asset_id` → `{path | embedded entry, content hash, probe summary}` and is what
the relink panel reads. Keeping every path in one entry is what makes the
privacy promise of §10 auditable: delete or scrub this entry and the project
carries no trace of the author's disk.

Media originals are **referenced, never moved**. Proxies and thumbnails may be
embedded under `media/` so that a project opened on another machine shows a real
timeline while the originals are relinked; a reader must treat a missing proxy
as "regenerate", never as "corrupt".

### 5.8 `preview.jpg`, `plugins.json`, `checksum.json` — optional

* `preview.jpg` — the poster shown in the project manager.
* `plugins.json` — plugin ids and versions the project depends on, so that
  "this project uses a plugin you do not have" is a sentence in the UI rather
  than a stack trace.
* `checksum.json` — per-entry SHA-256 plus a whole-document digest.

---

## 6. Reading a project

### 6.1 Open sequence

1. Verify the container opens as a ZIP and every entry name passes
   `is_valid_document_name`.
2. Read `manifest.json`. If `format_version` is **newer** than this build
   supports, **refuse** with a message naming both versions — never partially
   parse (§7).
3. Verify `checksum.json`, if present.
4. Parse `project.json` and `timeline/document.json`; rebuild any session index
   from the timeline graph.
5. Parse `captions/*.json`.
6. Run `validate_project` and surface the result.

### 6.2 Unknown fields are an error, on purpose

Every document rejects a mapping whose keys are not exactly the set its version
knows (`reject_unknown_fields`). This is deliberate and it is the opposite of
"be liberal in what you accept": a field the reader does not know is either from
a newer format — in which case the version check should have caught it — or it
is corruption. Silently ignoring it is how a project quietly loses an edit.

### 6.3 A damaged project must still open

`validate_project` reports the first problem as a sentence and construction
refuses only what a construction can see. A clip naming an asset the bin does
not hold, an effect bound to a deleted clip, a broken caption document: each is
reported, none is raised, and the user gets their edit back with a precise
description of what to fix (ADR-0015 rule 3).

---

## 7. Versioning and migration

`manifest.format_version` is an integer, starting at 1.

* **Newer than supported → refuse.** "This project was made by Nova Studio
  2.4 and this is 1.8; update to open it." No partial parse, ever.
* **Older → migrate.** Migrations are an ordered chain of pure functions
  `vN → vN+1`, one file each, applied in memory on open. A project is written
  in the current format **only on explicit user save** — opening an old file
  never rewrites it behind the user's back, because that would break their
  ability to go back to the old build.
* A migration must not read a clock, a filesystem or a network. It is a
  function from one mapping to another, and it is unit-tested against a fixture
  file committed next to it.

---

## 8. Writing: atomicity and crash recovery

**Atomic save.** Write to `<name>.nova.tmp-<random>` in the *same directory*,
`fsync` the file, then `os.replace` it over the target. A crash during a save can
never truncate the existing project. The previous version is kept as
`<name>.nova.bak` until the new one has been verified.

**Journal.** Executed commands are appended as NDJSON lines to
`<data>/autosave/<project>/cmds-*.ndjson`, one `JournalEntry` per line:
`{"seq":…, "at_ms":…, "name":…, "payload":{…}}`. The sequence number is the
entry's identity and must never be reused. A torn last line is the *expected*
state after a crash — the process died between writing the entry and its newline
— so a read reports it as `JournalWindow.torn_tail` and returns the entries that
did make it to disk, rather than declaring the whole journal corrupt.

**Checkpoints.** `CheckpointPolicy` decides when: every **200** commands or
**120** seconds, whichever comes first, keeping **5** revisions. The policy is
pure — a service that owns the clock counts and asks — so the recovery
guarantee ("you lose at most 200 commands or two minutes") is reviewable in one
line.

**Recovery.** On startup, if a project was open and the journal holds commands
past the last checkpoint, the user is offered: *restore to checkpoint*,
*replay commands onto the checkpoint*, or *discard*. The choice is the user's
because only they know whether the last two minutes were gold or garbage.

---

## 9. Integrity

`checksum.json` holds a SHA-256 per entry plus a digest over the canonical
documents. It allows damage in **one** entry to be detected without rejecting
the whole file:

* corrupt `preview.jpg`, `media/thumb/*` or a proxy → discard silently and
  regenerate; the edit is untouched.
* corrupt `captions/<id>.json` → open without that document, report which one.
* corrupt `timeline/document.json` → the recovery flow of §8, never a silent
  load of a partial edit.

Hashes travel with their algorithm (`ContentHash`), so a future move off SHA-256
is a data change and not a format change.

---

## 10. Privacy

* No telemetry, no analytics, no crash-report payload in the file.
* Absolute paths appear **only** in `media/index.json` (§5.7).
* No credentials, no licence keys, no machine identifiers.
* Scrubbing before sharing is a documented operation over one entry, which is
  the practical test of the promise above.

---

## 11. What is never in the file

Media originals · caches, waveforms and peak files · GPU or device state · the
undo stack (that is the journal, and it lives in the app data directory, not in
the project) · anything derived, since anything derived can be recomputed and
anything recomputed can go stale.

---

## 12. Open decisions

* **SQLite container vs ZIP.** ADR-0004 §6 describes a SQLite container;
  ADR-0015 decides `.nova` is a ZIP. The persistence port accepts either behind
  one adapter, but the choice must be made explicitly before `infra/persistence`
  is built. Tracked in ARCHITECTURE §6.1.
* **Embedded proxies by default.** Portability says embed; size says reference.
  The format allows both; the default is a product decision.
* **Sidecar retention.** `captions/sidecar/` is written but never read. Either
  it earns a reader or it should be removed in a later version.
