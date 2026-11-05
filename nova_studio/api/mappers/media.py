"""L4 — the media mapper: asset ↔ row, report ↔ answer.

Two decisions live here, and both are about what the panel can show without
asking again:

* **A row carries the probe, not a pointer to it.** Geometry, duration, stream
  counts and the warnings are all in the response, because a bin of two hundred
  clips that needed two hundred more requests to draw would be unusable.
* **A failure keeps the service's own words.** The code, the sentence and the
  remedy come from the `NovaError` the probe produced, not from a second table in
  the transport: the frontend localises on `code`, and a message rewritten here
  would be a message that disagrees with the log.

Nothing here probes, resolves or validates a path — the ingestor did all of that,
and a mapper that repeated it would be a second place the same rule lives.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nova_studio.api.schemas.media import (
    AudioSummary,
    ImportFailure,
    ImportResponse,
    MediaAssetSummary,
    MediaListResponse,
    VideoSummary,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from nova_studio.api.workspace import ImportedMedia
    from nova_studio.domain.media import AudioStreamInfo, MediaAsset, VideoStreamInfo
    from nova_studio.services.media import IngestFailure

__all__ = [
    "asset_summary",
    "audio_summary",
    "failure_summary",
    "import_response",
    "media_list_response",
    "video_summary",
]


def video_summary(video: VideoStreamInfo) -> VideoSummary:
    """One video stream, with the rate spelled out rather than rounded."""
    return VideoSummary(
        codec_name=video.codec_name,
        width=video.width,
        height=video.height,
        display_width=video.display_width,
        display_height=video.display_height,
        frame_rate=f"{video.timebase.num}/{video.timebase.den}",
        frame_count=video.frame_count,
        duration_seconds=video.duration_seconds,
        pixel_format=video.pixel_format,
        rotation=video.rotation,
        has_colour_metadata=not video.colour.is_unspecified,
    )


def audio_summary(audio: AudioStreamInfo) -> AudioSummary:
    """One audio stream."""
    return AudioSummary(
        codec_name=audio.codec_name,
        sample_rate=audio.sample_rate,
        channels=audio.channels,
        channel_layout=audio.channel_layout,
        duration_seconds=audio.duration_seconds,
    )


def asset_summary(asset: MediaAsset, *, warnings: Sequence[str] = ()) -> MediaAssetSummary:
    """One asset, as a row in the bin.

    Everything the row draws comes from the *persisted* probe, so a project whose
    originals are offline still shows correct geometry and duration rather than a
    spinner (ADR-0015 rule 3).
    """
    probe = asset.probe
    return MediaAssetSummary(
        asset_id=str(asset.asset_id),
        path=asset.path,
        name=asset.display_name,
        kind=asset.kind,
        linked=asset.is_linked,
        probed=asset.is_probed,
        duration_seconds=probe.duration_seconds if probe is not None else 0.0,
        warnings=list(warnings),
        video=[video_summary(stream) for stream in (probe.video if probe is not None else ())],
        audio=[audio_summary(stream) for stream in (probe.audio if probe is not None else ())],
    )


def failure_summary(failure: IngestFailure) -> ImportFailure:
    """One file that did not come in, in the service's own words."""
    return ImportFailure(
        path=failure.path,
        code=failure.error.code,
        message=failure.error.message,
        remedy=str(failure.error.remedy or ""),
    )


def import_response(project_id: str, imported: ImportedMedia) -> ImportResponse:
    """What an import produced, for a panel that redraws from the answer."""
    return ImportResponse(
        project_id=project_id,
        assets=[asset_summary(asset) for asset in imported.report.assets],
        failures=[failure_summary(failure) for failure in imported.report.failures],
        duplicates=list(imported.report.duplicates),
        summary=imported.report.summary(),
        journal_sequence=imported.project.journal_sequence,
        pending_commands=imported.project.pending_commands,
    )


def media_list_response(project_id: str, assets: Sequence[MediaAsset]) -> MediaListResponse:
    """The bin, and how much of it is currently missing."""
    return MediaListResponse(
        project_id=project_id,
        assets=[asset_summary(asset) for asset in assets],
        total=len(assets),
        missing=sum(1 for asset in assets if not asset.is_linked),
    )
