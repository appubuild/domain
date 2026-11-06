"""L4 — the project DTOs: what the frontend is allowed to know about a project.

Three rules decide what is in here:

1. **A DTO is not the entity.** `domain.project.Project` is the whole truth and
   it changes whenever the domain learns something; these are the wire shapes the
   frontend compiles against, and they change when the contract changes. A
   frontend that imported the entity would break every time the domain breathed.
2. **The frontend never decides whether a project is healthy.** The audit comes
   back as sentences produced by the domain (§"error handling" of
   `services/projects`), so there is one phrasing of a rule and not one per
   surface.
3. **Nothing here carries a path the user did not choose.** A path is echoed back
   as a string; the server resolves it against the session's own rules and never
   accepts a path it has not been told to open.

Counts and times are included not because the UI needs them all today but because
the alternative — the frontend loading a project to find out how long it is — is
a request per row of the recent-projects list.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

__all__ = [
    "AbsolutePath",
    "AssetRef",
    "AuditResponse",
    "CheckpointResponse",
    "CreateProjectRequest",
    "OpenProjectRequest",
    "OpenProjectResponse",
    "ProjectListResponse",
    "ProjectSummary",
    "RecoveryResponse",
    "SaveAsRequest",
    "SaveProjectResponse",
]


def _must_be_absolute(value: str) -> str:
    """Refuse a path that is not absolute.

    A relative path resolves against the process' working directory, which for a
    packaged desktop build is wherever the shortcut happened to point — not a
    place a user ever chose to put a project. Refusing at the boundary is what
    keeps "the file is missing" from being a lie told about a file that was
    written somewhere nobody looked.
    """
    from pathlib import PurePath

    if not PurePath(value).is_absolute():
        raise ValueError(
            "a project path must be absolute; a relative one would resolve against "
            "wherever the editor was launched from"
        )
    return value


#: A path the editor will touch. Every request field that names a file uses it.
AbsolutePath = Annotated[str, AfterValidator(_must_be_absolute)]


class _Strict(BaseModel):
    """The base every project DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class ProjectSummary(_Strict):
    """One project, as a row in a list or a heading in a window."""

    project_id: str = Field(description="Stable id; the key every other project call uses.")
    name: str = Field(description="The project's name, as the user typed it.")
    path: str | None = Field(
        default=None, description="The `.nova` file, or null for one never saved."
    )
    dirty: bool = Field(description="Whether the project in memory differs from the file.")
    clip_count: int = Field(description="Clips on the timeline.")
    duration_frames: int = Field(description="Length of the timeline, in frames.")
    pending_commands: int = Field(
        description="Edits since the last checkpoint — what a crash would lose."
    )
    commands_until_checkpoint: int = Field(
        description="How many more edits before autosave writes one."
    )
    autosave_due: bool = Field(description="Whether a checkpoint is owed right now.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 when nothing yet.")
    checkpoint_sequence: int = Field(description="Sequence of the newest checkpoint; 0 for none.")


class ProjectListResponse(_Strict):
    """Every project open in this session.

    A wrapper rather than a bare list, for the reason every collection in this
    API is one: a response that may later carry a cursor, a count or a recovery
    hint can grow without becoming a different response. A bare array cannot.
    """

    projects: list[ProjectSummary] = Field(
        default_factory=list, description="The open projects, in the order they were opened."
    )


class OpenProjectResponse(_Strict):
    """What opening returns: the project, and what is wrong with it.

    `warnings` is the whole of ADR-0015 rule 3 in one field — a project that opens
    with warnings is a project the user gets back, and the warnings are sentences
    written for them.
    """

    project: ProjectSummary = Field(description="The project that was opened.")
    warnings: list[str] = Field(
        default_factory=list, description="What the user should know, in their language."
    )
    recovered: bool = Field(
        default=False, description="Whether a journal was found for this project at open time."
    )


class CreateProjectRequest(_Strict):
    """A new, empty project."""

    name: str = Field(min_length=1, max_length=200, description="What to call it.")
    path: AbsolutePath | None = Field(
        default=None, description="Optional file to attach now; omit for an unsaved project."
    )
    author: str = Field(default="", max_length=200, description="Recorded in the project metadata.")
    description: str = Field(default="", max_length=2_000, description="Recorded in the metadata.")


class OpenProjectRequest(_Strict):
    """Open a file that exists."""

    path: AbsolutePath = Field(min_length=1, description="Absolute path of a `.nova` file.")


class SaveAsRequest(_Strict):
    """Save to a new location."""

    path: AbsolutePath = Field(
        min_length=1, description="Absolute path to write the `.nova` file to."
    )


class SaveProjectResponse(_Strict):
    """The outcome of a save."""

    project_id: str = Field(description="The project that was saved.")
    path: str = Field(description="Where it was written.")
    saved_at_ms: int = Field(description="Unix milliseconds of the save, for 'last saved'.")
    format_version: int = Field(description="The `.nova` format version written.")


class CheckpointResponse(_Strict):
    """The outcome of a checkpoint (a manual one, or an autosave tick)."""

    project_id: str = Field(description="The project that was checkpointed.")
    sequence: int = Field(description="Journalled sequence of this checkpoint.")
    revision: int = Field(description="Revision number in the archive.")
    recorded_at_ms: int = Field(description="Unix milliseconds of the checkpoint.")
    truncated: int = Field(description="Journal entries this checkpoint made redundant.")
    taken: bool = Field(default=True, description="False when an autosave tick found nothing owed.")


class AssetRef(_Strict):
    """One media asset, as the audit reports it."""

    asset_id: str = Field(description="Stable id.")
    name: str = Field(description="File name, or the name the user gave it.")
    kind: str = Field(description="`video`, `audio`, `image` or `other`.")


class AuditResponse(_Strict):
    """What a user would want to know about the state of this project."""

    project_id: str = Field(description="The project that was audited.")
    clean: bool = Field(description="Whether there is anything to tell the user.")
    problem: str = Field(description="The one structural problem, or an empty string.")
    missing_assets: list[AssetRef] = Field(
        default_factory=list, description="Assets referenced but not found on disk."
    )
    unused_assets: list[AssetRef] = Field(
        default_factory=list, description="Assets imported but never used."
    )
    summary: list[str] = Field(
        default_factory=list, description="The audit as sentences, in the user's language."
    )
    clip_count: int = Field(description="Clips on the timeline.")
    duration_frames: int = Field(description="Length of the timeline, in frames.")


class RecoveryResponse(_Strict):
    """What to offer the user after a crash, as the domain phrased it."""

    project_id: str = Field(description="The project the journal belongs to.")
    offers: list[str] = Field(
        default_factory=list, description="What can be done, best first: replay, restore, discard."
    )
    pending_commands: int = Field(description="Commands not yet baked into a checkpoint.")
    torn_tail: bool = Field(
        description="Whether the journal's last line was cut short by the crash."
    )
    checkpoint_sequence: int = Field(description="The checkpoint recovery would replay onto.")
    detail: str = Field(description="One sentence for the dialog, in the user's language.")
