"""L3 feature — projects: the lifecycle of a `.nova` file.

**Purpose.** Own what happens when a human touches a project file: opening one,
saving one, deciding whether it is in a good state, checkpointing it often
enough that a crash costs little, and — after a crash — working out what to
offer back. The domain decides *what a project is*; `infra/persistence`
decides *how the bytes are stored*; this decides *what the user experiences*.

**Folder structure.**

```
services/projects/
├── __init__.py   this file: the feature's contract
├── session.py    ProjectSession — open, save, checkpoint, audit
├── autosave.py   AutosaveState — when a checkpoint is owed, what history to keep
└── recovery.py   plan_recovery — what to offer after a crash
```

**Backend / frontend.** The frontend never opens a file and never decides
whether a project is healthy. It calls one API per intent — open, save,
checkpoint, audit — and renders what comes back: `OpenedProject.warnings` in a
banner, `ProjectAudit.summary()` in the relink panel, `RecoveryPlan.offers` as a
dialog. Every sentence shown to a user is produced here or in the domain, so
there is one phrasing of a rule and not one per surface.

**State management.** `ProjectSession` holds the archive, the clock and the
manifest it last saw — nothing else. `AutosaveState` and `RecoveryPlan` are
frozen values, so a snapshot can be handed to a worker or compared in a test.
No mutable project state lives in this feature: the project is the caller's.

**Functions.**

| Call | Answers |
| --- | --- |
| `ProjectSession.open()` | "give me this project, and tell me what is wrong with it" |
| `ProjectSession.save(project)` | "make it durable, and tell me when" |
| `ProjectSession.checkpoint(project)` | "remember this moment" |
| `ProjectSession.audit(project)` | "what should the user fix" |
| `AutosaveState.recorded(...)` / `.due(...)` / `.checkpointed(...)` | "is it time" |
| `plan_recovery(window, checkpoint_sequence)` | "what do we offer after a crash" |

**Events.** None yet, and deliberately: opening and saving already return values
to a caller that knows the outcome. When the plugin service gains a lifecycle,
`services/projects` will subscribe to `plugin.effect.*` to re-audit open
projects, and to `media.relinked` to clear a missing-asset warning.

**Error handling.** `Result[T]` throughout. Codes:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `NS-PROJECT-4001` | Written by a newer Nova Studio; refused whole (ADR-0015 rule 5). | No — update. |
| `NS-PROJECT-4002` | A required document is missing or unreadable. | No — restore. |
| `NS-PROJECT-4003` | The project rebuilt into something invalid. | No — restore. |
| `NS-PROJECT-4004` | The save did not become durable; the old file is intact. | **Yes.** |

Everything else — a moved clip, a corrupt caption document, a dangling binding —
is a **warning on a project that still opens** (ADR-0015 rule 3).

**Caching.** None. A session reads what it is asked to read; a `.nova` file is
tens of kilobytes of JSON and a save rewrites it wholesale. Caching a project
across a save would be a stale-read bug with a performance justification.

**Performance.** Open is one manifest read, two document reads and one caption
listing; save is two or three document writes plus one commit. The commit is the
atomic replace — the expensive part — which is exactly why autosave checkpoints
every 200 commands rather than every one (ADR-0015 rule 6).

**Testing.** `tests/services/test_projects_session.py` uses an in-memory archive
and a frozen clock: open, save and round-trip without a filesystem, plus every
warning path (missing media, a corrupt caption, a dangling binding).
`tests/services/test_projects_autosave.py` pins the "you lose at most N commands
or T seconds" guarantee. `tests/services/test_projects_recovery.py` pins the
offers, including the torn-tail case.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **Migration.** `format_version` is compared but not yet migrated; the ordered
  chain of `vN → vN+1` functions belongs here, applied inside `open()`.
* **Save-as and template export**, which reuse `_documents` verbatim.
* **Autosave to a sidecar** (ADR-0015 rule 6) once `infra/persistence` exists.
"""

from __future__ import annotations

from nova_studio.services.projects.autosave import DEFAULT_AUTOSAVE, AutosaveState
from nova_studio.services.projects.recovery import (
    RecoveryOffer,
    RecoveryPlan,
    entries_after_checkpoint,
    plan_recovery,
)
from nova_studio.services.projects.session import (
    NS_PROJECT_MISSING_DOCUMENT,
    NS_PROJECT_SAVE_FAILED,
    NS_PROJECT_UNREADABLE,
    NS_PROJECT_UNSUPPORTED_VERSION,
    OpenedProject,
    ProjectAudit,
    ProjectSession,
)

__all__ = [
    "DEFAULT_AUTOSAVE",
    "NS_PROJECT_MISSING_DOCUMENT",
    "NS_PROJECT_SAVE_FAILED",
    "NS_PROJECT_UNREADABLE",
    "NS_PROJECT_UNSUPPORTED_VERSION",
    "AutosaveState",
    "OpenedProject",
    "ProjectAudit",
    "ProjectSession",
    "RecoveryOffer",
    "RecoveryPlan",
    "entries_after_checkpoint",
    "plan_recovery",
]
