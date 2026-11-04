# ADR-0015 — `.nova` project file as a versioned container

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

A project file must hold a timeline graph, asset references, caption documents with word
timings, templates, fonts in use, effect parameters, markers, metadata, a preview image and
a version — and it must survive ten years of format evolution, be copyable by hand, be
attachable to a bug report, be recoverable after a crash, and be inspectable by a support
engineer with no proprietary tooling.

Requirements pull in opposite directions: **portability** favours a single self-contained
file including media; **size** forbids embedding 4K sources; **inspectability** favours
plain text; **performance** favours binary; **safety** favours atomic writes and history.

## Decision

A `.nova` file is a **ZIP container** with a fixed layout, canonical-JSON documents, and
optional embedded media. Full specification: `docs/architecture/project-file-format.md`.

```
project.nova  (ZIP, deflate; media entries may be STORED)
├── manifest.json          format_version, app_version, created/modified, uuid, kind
├── project.json           metadata, settings, rate/timebase, colour/ audio config
├── timeline/
│   ├── document.json      THE authoritative timeline graph (canonical JSON)
│   └── revisions/         N most recent checkpoint documents (bounded, default 5)
├── captions/
│   ├── <doc_id>.json      CaptionDocument incl. segments/words/chars, revisions, deltas
│   └── sidecar/*.srt|vtt  user-exported copies (informational, never read as truth)
├── templates/             CaptionTemplate / effect / transition documents in use
├── fonts/                 only fonts whose licence permits embedding, else a reference list
├── media/                 OPTIONAL embedded proxies/thumbnails; originals are referenced
│   ├── index.json         asset_id → path|embedded entry, hash, probe summary
│   └── thumb/<asset>.jpg  preview poster
├── preview.jpg            poster shown in the project manager
├── plugins.json           plugin ids + versions the project depends on
└── checksum.json          per-entry SHA-256 + whole-document digest
```

Key rules:

1. **`timeline/document.json` is the single source of truth** for structure; the SQLite
   tables inside the working session are a derived index rebuilt from it on open
   (ADR-0004). Opening a project is: verify checksums → parse document → rebuild index →
   verify integrity → ready.
2. **Canonical JSON** (sorted keys, no insignificant whitespace, UTF-8, `\n`) so that
   byte-level diffing works, checksums are stable, and two saves of an unchanged project are
   identical. This makes user-visible "did my project change?" questions answerable.
3. **Media are referenced by absolute path + content hash, never moved.** A missing asset is
   a first-class state (`AssetLinkState.MISSING`) with a relink workflow; the project still
   opens and still edits. Proxies and thumbnails *may* be embedded so a project opened on
   another machine can show a real timeline immediately while originals are relinked.
4. **Atomic writes**: save to `<name>.nova.tmp-<rand>` in the same directory, `fsync`, then
   `os.replace`. A crash during save can never truncate the existing project. The previous
   version is kept as `<name>.nova.bak` until the new one verifies.
5. **Versioning & migration**: `manifest.format_version` is an integer; migrations are an
   ordered chain of pure functions `vN → vN+1` in `infra/persistence/project_migrations/`.
   Opening a newer-than-supported file is refused with a precise message (never partially
   parsed). Opening an older file migrates in memory and is saved in the current format only
   on explicit user save.
6. **Crash recovery**: an append-only `command log` (`<data>/autosave/<project>/cmds-*.ndjson`)
   records executed commands with sequence numbers; a checkpoint document is written every
   N commands or T seconds. On startup, if a project was open and the log has commands past
   the last checkpoint, the recovery service offers: *restore to checkpoint*,
   *replay commands onto checkpoint*, or *discard*. Autosave writes a full
   `<name>.autosave.nova` on the same cadence.
7. **Integrity**: `checksum.json` allows detecting corruption in one entry without rejecting
   the whole file; a corrupt `preview.jpg` is discarded silently, a corrupt
   `timeline/document.json` triggers the recovery flow.
8. **Privacy**: no telemetry, no absolute user paths outside `media/index.json`, and the
   format documents exactly which fields may contain machine-specific data so a user can
   scrub before sharing.

## Consequences

**Positive**

* One portable file, openable by any zip tool; a support engineer can read the timeline JSON
  directly and reproduce a bug.
* Atomic save + `.bak` + checkpoints + command log means user work is very hard to lose.
* Canonical JSON gives stable diffs — a real advantage for bug reports and for a future
  collaboration feature.
* Migration chain makes ten-year evolution a mechanical, testable process; every migration
  has a fixture project from the version it migrates *from*.
* Missing media is survivable, which is the difference between an annoying and a catastrophic
  user experience.

**Negative / accepted**

* ZIP is not ideal for huge embedded media; we therefore embed only proxies/thumbnails by
  default and keep originals external.
* Dual representation (document + SQLite index) costs rebuild time on open, proportional to
  timeline size; measured budget is < 300 ms for a 1-hour project, and index rebuild is
  parallelisable if it ever grows.
* Canonical JSON is stricter than `json.dumps` defaults; all writes must go through the
  serializer in `infra/persistence/canonical_json.py`.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Single JSON file | Not atomic at scale, cannot embed binaries, no per-entry integrity, poor compression |
| SQLite-only project file | Opaque to users and support; harder to diff; embedding binary previews is awkward; also we *do* use SQLite for the working index, so this would conflate the two roles |
| Proprietary binary format | Undiffable, unrepairable, no third-party tooling, a ten-year liability |
| Folder-based project (Final Cut style) | Not a single portable artefact; users lose projects by copying the wrong file |
| Embedding all media | Multi-GB project files; duplicates the user's media; slow saves |
