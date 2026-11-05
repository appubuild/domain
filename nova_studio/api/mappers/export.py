"""L4 — the export dialog's words to the engine's, and back.

The dialog says "MP4, high quality". The engine wants a `ContainerFormat`, a
`VideoEncodeSpec` with a `Timebase` and a `RateControl`, and an exact frame
size. This module is the only place that translation happens, which is what
keeps two clients from disagreeing about what "high quality" is.

Two rules:

* **Defaults live here, not in a client.** A default copied into a window is a
  default two windows will eventually disagree about, and the disagreement
  shows up as two exports of the same project that do not match.
* **What the project knows, the client need not repeat.** The size and the
  timebase default to the project's, so the dialog can ask for "an export"
  without first fetching the project's frame size and doing arithmetic in
  JavaScript that the domain already owns.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nova_studio.core.temporal import Timebase
from nova_studio.domain.export import (
    ContainerFormat,
    OutputSpec,
    RateControl,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.services.render import ExportRequest

if TYPE_CHECKING:
    from nova_studio.api.schemas.export import StartExportRequest
    from nova_studio.domain.project import Project

__all__ = ["export_request_from", "spec_from"]


def spec_from(request: StartExportRequest, project: Project) -> OutputSpec:
    """The output spec an export of this project should be written with.

    Args:
        request: What the dialog asked for.
        project: The project, for the size and the timebase the dialog did not
            specify.

    Raises:
        `NovaInvariantError` when the container, the codec or the size is one
        the domain cannot build — surfaced as a 422 by the router rather than
        as a job that fails a minute after it was queued.
    """
    size = project.settings.frame_size
    container = ContainerFormat(request.container)
    return OutputSpec(
        container=container,
        video=VideoEncodeSpec(
            codec=VideoCodec(request.codec),
            width=request.width if request.width is not None else size.width,
            height=request.height if request.height is not None else size.height,
            timebase=project.timeline.timebase
            if project.timeline.timebase
            else Timebase(num=30, den=1),
            rate_control=RateControl.for_crf(request.crf),
            preset=request.preset,
        ),
        faststart=request.faststart,
    )


def export_request_from(request: StartExportRequest, project: Project) -> ExportRequest:
    """The job's request: where the frames come from and where they go."""
    return ExportRequest(
        path=request.path,
        spec=spec_from(request, project),
        start_frame=request.start_frame,
        end_frame=request.end_frame,
        fail_on_missing=request.fail_on_missing,
    )
