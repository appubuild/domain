"""L4 — the export DTOs: what the export dialog sends when the button is pressed.

The dialog edits a *destination* and a *quality*; the engine wants a container,
a codec, a rate control, a timebase and a pixel format. These DTOs are the first
half, not the second: a user picks MP4 and "high quality", not `yuv420p` and
`RateControl.for_crf(20)`. The mapper is where one becomes the other, which is
also the only place the defaults live — a default duplicated into a client is a
default two clients will disagree about.

Three decisions worth naming:

* **The request is a question; the answer is a job id.** An export takes
  minutes. A request that blocked for one would be indistinguishable from a
  hang, so this returns `202` and the work is followed on the socket
  (`job.progress`) and at `GET /api/v1/jobs/{id}`.
* **Size defaults to the project.** An export at the project's own size is what
  nearly every export is, and forcing the client to know the project's frame
  size to ask for it would put domain knowledge in a dialog.
* **A path is used, never improved.** The client got it from a native dialog;
  a relative path is refused at the boundary because it would resolve against
  the process' working directory, which in a packaged build is wherever the
  shortcut happened to point.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["ExportSubmission", "StartExportRequest"]


class _Strict(BaseModel):
    """The base every export DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class StartExportRequest(_Strict):
    """ "Export this project, there, like that."""

    path: str = Field(
        description=(
            "Where the file goes. Absolute: a job runs in a worker whose working "
            "directory is not the user's."
        )
    )
    start_frame: int = Field(default=0, ge=0, description="First timeline frame, inclusive.")
    end_frame: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Last timeline frame, exclusive. Omitted means the end of the project, "
            "resolved when the job runs rather than when it was queued."
        ),
    )
    #: What the dialog shows as a format picker.
    container: str = Field(default="mp4", description="Container: mp4, mov, mkv, webm.")
    codec: str = Field(default="h264", description="Video codec: h264, hevc, av1, prores, vp9.")
    width: int | None = Field(
        default=None, ge=2, description="Output width; defaults to the project's."
    )
    height: int | None = Field(
        default=None, ge=2, description="Output height; defaults to the project's."
    )
    crf: int = Field(
        default=23,
        ge=0,
        le=51,
        description=(
            "Constant quality, 0-51, lower is better. Ignored for a codec without a "
            "constant-quality mode."
        ),
    )
    preset: str = Field(
        default="veryfast", description="Encoder preset: a dialog-exposed speed/quality knob."
    )
    faststart: bool = Field(
        default=False,
        description="Move the index to the front so streaming starts immediately.",
    )
    fail_on_missing: bool = Field(
        default=False,
        description=(
            "Refuse the export when an asset is offline. Off by default: most projects "
            "being exported have at least one drive that is not plugged in."
        ),
    )
    #: Urgency, not speed: it decides which pool the job runs in and who is
    #: admitted when a slot is free. Only the three classes a user can sensibly
    #: choose are offered — `critical` is for work the UI is blocked on and
    #: `idle` is for work nobody is waiting for.
    priority: str = Field(
        default="low",
        description="Job urgency: low, normal or high.",
    )


class ExportSubmission(_Strict):
    """What comes back: a job id, and where to watch it."""

    job_id: str = Field(description="The id to follow on the socket and in the job list.")
    project_id: str = Field(description="The project being exported.")
    status: str = Field(description="Where the job was when the answer was written.")
    frames: int = Field(description="How many frames it will render.")
    detail: str = Field(description="One line for the status bar: destination and length.")
