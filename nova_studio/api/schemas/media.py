"""L4 — the media DTOs: what is in the bin, and what an import got us.

Three rules decide the shape of these:

1. **An import is a report, never a failure.** Dropping forty files on a panel
   and getting a 400 because one of them is a text file is an editor that makes
   the user import in batches and guess which file was bad. Failures travel
   *inside* a 200, one per path, each carrying the code the frontend maps to a
   local sentence.
2. **A path is echoed, never resolved.** The client is a window that got the path
   from a native dialog; the server's job is to use it, not to improve it. A
   relative path is refused at the boundary, because it would resolve against the
   process' working directory and not against anything the user chose.
3. **The panel gets what it can draw without a second request.** A thumbnail
   strip needs geometry, duration and a name; a bin of two hundred clips must not
   cost two hundred more round trips to show them.

Deliberately absent: anything only a live container could answer. The probe
summary is the *persisted* half of a probe (ADR-0015), which is why a project
opens with correct placeholders while the originals are still on a camera card
somewhere.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Runtime imports, both of them: pydantic resolves a model's annotations when the
# class is created, and under `from __future__ import annotations` a name that
# exists only for mypy is not a type — it is an unresolved forward reference.
from nova_studio.api.schemas.projects import AbsolutePath  # noqa: TC001 — see above
from nova_studio.domain.media import AssetKind  # noqa: TC001 — see above

__all__ = [
    "AudioSummary",
    "EnsureMediaRequest",
    "EnsureMediaResponse",
    "ImportFailure",
    "ImportRequest",
    "ImportResponse",
    "MediaAssetSummary",
    "MediaCacheDroppedResponse",
    "MediaCacheEntrySummary",
    "MediaCacheResponse",
    "MediaCacheTrimResponse",
    "MediaJobSummary",
    "MediaListResponse",
    "VideoSummary",
]


class _Strict(BaseModel):
    """The base every media DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class VideoSummary(_Strict):
    """One video stream, as the bin and the inspector show it."""

    codec_name: str = Field(description="The codec, as the file reported it.")
    width: int = Field(description="Coded width in pixels.")
    height: int = Field(description="Coded height in pixels.")
    display_width: int = Field(
        description="Width as it should be shown: aspect ratio and rotation applied."
    )
    display_height: int = Field(description="Height as it should be shown.")
    frame_rate: str = Field(description="Exact rate as `num/den`, e.g. `30000/1001`.")
    frame_count: int = Field(description="Frames in the stream; 0 when the file does not say.")
    duration_seconds: float = Field(description="Stream length, from the frame count and the rate.")
    pixel_format: str = Field(description="Pixel format, e.g. `yuv420p`.")
    rotation: int = Field(description="Degrees to rotate for display: 0, 90, 180 or 270.")
    has_colour_metadata: bool = Field(
        description="Whether the file declared its colour, or left it unspecified."
    )


class AudioSummary(_Strict):
    """One audio stream."""

    codec_name: str = Field(description="The codec, as the file reported it.")
    sample_rate: int = Field(description="Samples per second.")
    channels: int = Field(description="Channel count.")
    channel_layout: str = Field(
        description="Layout name, e.g. `stereo`; empty when the file does not say."
    )
    duration_seconds: float = Field(description="Stream length, from the sample count.")


class MediaAssetSummary(_Strict):
    """One asset in the bin: everything a row needs to draw itself."""

    asset_id: str = Field(description="Stable id; the key every clip references.")
    path: str = Field(description="Where the file was when it was imported.")
    name: str = Field(description="File name, without the directory — what the row shows.")
    kind: AssetKind = Field(
        description="What the probe decided it is; never guessed from the suffix."
    )
    linked: bool = Field(description="Whether the recorded path resolved on last check.")
    probed: bool = Field(description="Whether a probe summary is available.")
    duration_seconds: float = Field(description="Length of the file; 0 when it reported none.")
    warnings: list[str] = Field(description="Anything odd the user should know, as sentences.")
    video: list[VideoSummary] = Field(description="Video streams, in file order.")
    audio: list[AudioSummary] = Field(description="Audio streams, in file order.")


class MediaListResponse(_Strict):
    """The bin."""

    project_id: str = Field(description="The project these assets belong to.")
    assets: list[MediaAssetSummary] = Field(description="Everything in the bin, in import order.")
    total: int = Field(description="How many there are.")
    missing: int = Field(description="How many no longer resolve to a file.")


class ImportRequest(_Strict):
    """Files to import.

    A batch, because that is what a drag-and-drop is: forty files at once, and
    the answer is a report rather than a success or a failure.
    """

    paths: list[AbsolutePath] = Field(
        min_length=1,
        max_length=500,
        description="Absolute paths to import; duplicates within the list are skipped.",
    )


class ImportFailure(_Strict):
    """One file that did not come in, and what to do about it."""

    path: str = Field(description="The path that failed.")
    code: str = Field(description="The error code; the frontend maps it to a local message.")
    message: str = Field(description="What happened, as a sentence.")
    remedy: str = Field(description="What the user can do about it; empty when there is nothing.")


class ImportResponse(_Strict):
    """What an import produced.

    A 200 whatever happened to the individual files: a batch cannot fail as a
    batch, and the user needs the list, not a verdict.
    """

    project_id: str = Field(description="The project the assets were added to.")
    assets: list[MediaAssetSummary] = Field(description="What came in, with anything odd about it.")
    failures: list[ImportFailure] = Field(description="What did not, one entry per path.")
    duplicates: list[str] = Field(description="Paths already in the project, or offered twice.")
    summary: str = Field(description="One sentence for the status bar.")
    journal_sequence: int = Field(description="Newest journalled sequence; 0 for none.")
    pending_commands: int = Field(description="Edits since the last checkpoint.")


class EnsureMediaRequest(_Strict):
    """Ask for the derived copies the project is missing.

    Both halves are on by default and each can be turned off, because the two
    answers cost wildly different amounts: a thumbnail strip is eight seeks, a
    proxy is minutes of CPU. A panel that only needs tiles should be able to say
    so, and "give me everything" should still be one call.
    """

    proxies: bool = Field(default=True, description="Transcode the proxies the timeline needs.")
    thumbnails: bool = Field(
        default=True, description="Make the thumbnail strips that are missing."
    )


class MediaJobSummary(_Strict):
    """One job the request started.

    The id is what the client watches: progress, completion and failure arrive
    on the socket, not in this response, and a job is the only handle that ties
    the two together (ADR-0010 §7).
    """

    job_id: str = Field(description="The job to watch on /api/v1/ws.")
    kind: str = Field(description="`proxy` or `thumbnail`.")
    asset_id: str = Field(description="The asset the job is working for.")
    count: int = Field(description="How many artefacts it will produce: one proxy, or a strip.")
    status: str = Field(description="The status at the moment it was accepted.")
    detail: str = Field(description="One line for the status bar.")


class EnsureMediaResponse(_Strict):
    """What asking for derived media produced.

    202, and a list that may be empty: an up-to-date project has nothing to
    make, and that is the ordinary case after the first pass rather than an
    error. The counts are what a panel shows while the work runs.
    """

    project_id: str = Field(description="The project the jobs were planned against.")
    jobs: list[MediaJobSummary] = Field(description="What was queued, in submission order.")
    proxies: int = Field(description="How many transcodes were queued.")
    strips: int = Field(description="How many thumbnail strips were queued.")
    summary: str = Field(description="One sentence for the status bar.")


class MediaCacheEntrySummary(_Strict):
    """One derived artefact the install is holding."""

    key: str = Field(description="Its cache key, which is also its file name.")
    kind: str = Field(description="`proxy`, `thumbnail`, and so on.")
    size_bytes: int = Field(description="What it costs on disk, as recorded.")
    created_ms: int = Field(description="When it was made.")
    last_used_ms: int = Field(description="When a decode last asked for it.")


class MediaCacheResponse(_Strict):
    """What the derived-media cache holds, oldest use first.

    The order is the order eviction will take them in, which is the one thing
    an inspector and a byte budget both want to read off the same list.
    """

    entries: list[MediaCacheEntrySummary] = Field(description="What we hold, oldest use first.")
    total: int = Field(description="How many entries there are.")
    size_bytes: int = Field(description="What they cost in total, as recorded.")


class MediaCacheTrimResponse(_Strict):
    """What one eviction pass cost, and whether it was enough.

    Admission enforces the budget by itself, so this is the endpoint for the two
    cases admission cannot see: a budget that was just lowered, and bytes that
    were admitted before there was a budget at all.

    `shortfall_bytes` is the honest part: when every evictable entry is pinned,
    the cache is still over and the caller hears by how much rather than being
    told nothing happened.
    """

    entries: int = Field(description="How many entries were evicted.")
    size_bytes: int = Field(description="How many bytes they had named.")
    shortfall_bytes: int = Field(description="Bytes still over budget; zero when it fit.")
    failures: int = Field(description="Entries chosen but not removable. Still on the disk.")
    summary: str = Field(description="One sentence for the status bar.")


class MediaCacheDroppedResponse(_Strict):
    """What deleting derived media freed.

    The count is what actually went, not what was asked for: an entry that
    refused to be deleted is still on the disk, and a caller that hears eleven
    when it asked for twelve needs to be able to tell.
    """

    entries: int = Field(description="How many entries were removed.")
    size_bytes: int = Field(description="How many bytes they had named.")
    summary: str = Field(description="One sentence for the status bar.")
