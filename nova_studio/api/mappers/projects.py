"""L4 — the project mapper: entity ↔ DTO, and nothing else.

Two of these translations carry a rule worth writing down:

* **A name the user sees comes from the asset's file name, not its path.** A path
  is a machine's answer to "which file"; the audit panel is for a person, and a
  person asked to relink `C:\\Users\\me\\Shoot 12\\A001C003_240101.mov` wants to
  read `A001C003_240101.mov`.
* **`autosave_due` is computed here, not stored.** It is a function of the
  counter and *now*, so storing it would make it wrong the moment it was read —
  and a summary is read more often than it is produced.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from nova_studio.api.schemas.projects import (
    AssetRef,
    AuditResponse,
    CheckpointResponse,
    OpenProjectResponse,
    ProjectSummary,
    RecoveryResponse,
    SaveProjectResponse,
)

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.api.workspace import Checkpoint, OpenProject, SavedProject
    from nova_studio.domain.media import MediaAsset
    from nova_studio.services.projects import ProjectAudit, RecoveryPlan

__all__ = [
    "asset_ref",
    "audit_response",
    "checkpoint_response",
    "open_project_response",
    "project_summary",
    "recovery_response",
    "save_response",
]


def project_summary(project: OpenProject, *, now_ms: int) -> ProjectSummary:
    """One open project, as the frontend should show it."""
    return ProjectSummary(
        project_id=project.project_id,
        name=project.name,
        path=_as_text(project.path),
        dirty=project.dirty,
        clip_count=project.project.clip_count,
        duration_frames=project.project.duration_frames,
        pending_commands=project.pending_commands,
        commands_until_checkpoint=project.autosave.commands_until_due(),
        autosave_due=project.autosave.due(now_ms=now_ms),
        journal_sequence=project.journal_sequence,
        checkpoint_sequence=project.checkpoint_sequence,
    )


def open_project_response(
    project: OpenProject, *, now_ms: int, warnings: tuple[str, ...] = (), recovered: bool = False
) -> OpenProjectResponse:
    """The answer to "open this", including everything the user should be told."""
    return OpenProjectResponse(
        project=project_summary(project, now_ms=now_ms),
        warnings=list(warnings),
        recovered=recovered,
    )


def save_response(saved: SavedProject) -> SaveProjectResponse:
    """The answer to "save this"."""
    return SaveProjectResponse(
        project_id=saved.project_id,
        path=str(saved.path),
        saved_at_ms=saved.saved_at_ms,
        format_version=saved.format_version,
    )


def checkpoint_response(
    checkpoint: Checkpoint | None,
    *,
    project_id: str = "",
    revision: int = 0,
    sequence: int = 0,
) -> CheckpointResponse:
    """The answer to "checkpoint this", whether or not one was taken.

    An autosave tick that found nothing owed still has to answer, and the answer
    is not an error — it is `taken: false`, which the UI shows by not changing.
    """
    if checkpoint is None:
        return CheckpointResponse(
            project_id=project_id,
            sequence=sequence,
            revision=revision,
            recorded_at_ms=0,
            truncated=0,
            taken=False,
        )
    return CheckpointResponse(
        project_id=checkpoint.project_id,
        sequence=checkpoint.sequence,
        revision=checkpoint.revision.sequence,
        recorded_at_ms=checkpoint.recorded_at_ms,
        truncated=checkpoint.truncated,
        taken=True,
    )


def audit_response(project_id: str, audit: ProjectAudit) -> AuditResponse:
    """The answer to "how is this project", in the domain's own sentences."""
    return AuditResponse(
        project_id=project_id,
        clean=audit.is_clean,
        problem=audit.problem,
        missing_assets=[asset_ref(asset) for asset in audit.missing_assets],
        unused_assets=[asset_ref(asset) for asset in audit.unused_assets],
        summary=list(audit.summary()),
        clip_count=audit.clip_count,
        duration_frames=audit.duration_frames,
    )


def recovery_response(project_id: str, plan: RecoveryPlan) -> RecoveryResponse:
    """The answer to "can this be recovered"."""
    return RecoveryResponse(
        project_id=project_id,
        offers=[str(offer) for offer in plan.offers],
        pending_commands=plan.pending_commands,
        torn_tail=plan.torn_tail,
        checkpoint_sequence=plan.checkpoint_sequence,
        detail=plan.detail,
    )


def asset_ref(asset: MediaAsset) -> AssetRef:
    """One asset, named the way the domain names it in its own sentences.

    `display_name` and not our own path arithmetic: the relink panel and the
    audit summary must call the same file the same thing, and one of the two
    places is always the place nobody updated.
    """
    return AssetRef(
        asset_id=str(asset.asset_id),
        name=asset.display_name,
        kind=_kind_of(asset),
    )


def _as_text(path: Path | None) -> str | None:
    return None if path is None else str(path)


def _kind_of(asset: MediaAsset) -> str:
    kind: Any = asset.kind
    return str(getattr(kind, "value", kind))
