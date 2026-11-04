"""L4 — where things live: the shape of the app data directory.

A video editor writes three kinds of file beside the user's project, and all
three have to be findable by a support engineer reading a bug report, findable
by a user who wants to clean up, and impossible to write into the wrong place:

```
<data_root>/                       the app data directory (ADR-0014)
├── autosave/
│   └── <project_id>/
│       └── cmds-<ms>-<token>.ndjson   the journal for one project
└── cache.sqlite3                  one install-wide index of derived bytes

<project path>.nova.bak            the previous version of a project file
<project path>.nova.tmp-<token>    a save in progress, in the same directory
```

Two rules make this more than a pile of constants:

* **The journal lives outside the project file.** The undo stack is not part of
  the edit (`project-file-format.md` §11), and a crash journal certainly is not:
  it is the record of work that has *not* been saved yet. Keeping it in the data
  directory means a project copied to a USB stick carries no trace of the
  author's last two minutes, and means a shared project cannot leak them.
* **A temporary file is written in the same directory as its target**, never in
  `/tmp`. `os.replace` is only atomic within one filesystem, so a save that
  staged somewhere else would not be atomic at all — it would be a copy.

A project id becomes a directory name, which makes it untrusted input in exactly
the way an archive entry name is: `../../etc` as a project id is the zip-slip
attack wearing a different hat. The same domain predicate is the guard, because
the two problems are the same problem.

Nothing here touches the filesystem: every function is path arithmetic, so the
layout is testable without a temp directory and reviewable in one screen.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from nova_studio.domain.persistence import is_valid_document_name

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "AUTOSAVE_SUBDIR",
    "BACKUP_SUFFIX",
    "CACHE_DATABASE_NAME",
    "JOURNAL_PREFIX",
    "JOURNAL_SUFFIX",
    "backup_path",
    "cache_database_path",
    "is_journal_name",
    "is_safe_project_id",
    "journal_dir",
    "journal_name",
    "journal_started_ms",
    "temp_path",
]

#: Where per-project autosave data lives, relative to the app data directory.
#: Named by the format spec §8, which promises this exact shape.
AUTOSAVE_SUBDIR: Final[str] = "autosave"

#: One install-wide SQLite database of derived artefacts.
CACHE_DATABASE_NAME: Final[str] = "cache.sqlite3"

#: Journal files are `cmds-<started_ms>-<token>.ndjson`.
JOURNAL_PREFIX: Final[str] = "cmds-"
JOURNAL_SUFFIX: Final[str] = ".ndjson"

#: The previous version of a project file, kept until a save has been verified.
BACKUP_SUFFIX: Final[str] = ".bak"

#: The marker in a temporary file's name, so a support engineer can tell a save
#: that was interrupted from a file that belongs to something else.
TEMP_MARKER: Final[str] = ".tmp-"


def is_safe_project_id(project_id: str) -> bool:
    """Whether ``project_id`` may become a directory name.

    A project id reaches us from a project file, which is untrusted input. The
    rules are the archive's rules because the risk is the same: a name that
    escapes its parent is not an id, it is a path.
    """
    return is_valid_document_name(project_id)


def journal_dir(data_root: Path, project_id: str) -> Path:
    """The directory holding one project's journals.

    Raises:
        ValueError: ``project_id`` is not safe to use as a directory name.
    """
    if not is_safe_project_id(project_id):
        raise ValueError(f"project id {project_id!r} cannot be used as a directory name")
    return data_root / AUTOSAVE_SUBDIR / project_id


def journal_name(started_ms: int, token: str) -> str:
    """The name of one journal file.

    The timestamp is in the name so that `ls` reads as history and so that the
    newest journal is the newest name; the token is there so that two processes
    starting in the same millisecond do not write to the same file.
    """
    if started_ms < 0:
        raise ValueError(f"journal start must not be negative, got {started_ms}")
    if not token or "/" in token or "\\" in token:
        raise ValueError(f"journal token must be a bare name, got {token!r}")
    return f"{JOURNAL_PREFIX}{started_ms}-{token}{JOURNAL_SUFFIX}"


def is_journal_name(name: str) -> bool:
    """Whether ``name`` is one of our journal files.

    Anything else in the directory is left alone: a user's own notes, or a file
    from a build that named things differently, is not ours to delete.
    """
    return (
        name.startswith(JOURNAL_PREFIX)
        and name.endswith(JOURNAL_SUFFIX)
        and len(name) > len(JOURNAL_PREFIX) + len(JOURNAL_SUFFIX)
    )


def journal_started_ms(name: str) -> int:
    """When the journal named ``name`` was started, for picking the newest.

    Returns ``0`` for a name whose timestamp has been mangled, so that a
    half-renamed file sorts oldest rather than crashing a startup routine.
    """
    body = name[len(JOURNAL_PREFIX) : -len(JOURNAL_SUFFIX)]
    head = body.split("-", 1)[0]
    return int(head) if head.isdigit() else 0


def cache_database_path(data_root: Path) -> Path:
    """The one cache index for this install."""
    return data_root / CACHE_DATABASE_NAME


def backup_path(project_path: Path) -> Path:
    """Where the previous version of a project file is kept.

    Appended rather than replaced, so `holiday.nova` becomes
    `holiday.nova.bak` — a name the user recognises, next to the file it
    protects, with the extension still visible to anything that looks at it.
    """
    return project_path.with_name(f"{project_path.name}{BACKUP_SUFFIX}")


def temp_path(project_path: Path, token: str) -> Path:
    """The staging path for a save of ``project_path``.

    Same directory, always: `os.replace` is atomic within a filesystem and is a
    copy across one, so staging anywhere else would quietly give up the only
    property this whole dance exists for.
    """
    if not token or "/" in token or "\\" in token:
        raise ValueError(f"temporary file token must be a bare name, got {token!r}")
    return project_path.with_name(f"{project_path.name}{TEMP_MARKER}{token}")
