"""L4 — the render router: one frame, and the frames after it.

Three endpoints, because a preview panel has exactly three verbs: **show me this
frame**, **have the next few ready**, and **forget what you decoded**.

The first one answers in `image/jpeg` rather than in JSON, and that is a
deliberate exception to the house style rather than an oversight. A preview
frame is a picture; a picture inside JSON is a base64 string a third larger,
decoded on the main thread of a UI that is already busy drawing. The geometry
the panel needs travels in headers instead — scale, offset, size and gaps —
which is the only part of a frame a client reads rather than blits.

What is *not* here is as deliberate:

* **No "render this range".** That is an export, it is a job (ADR-0010), and it
  belongs to the export surface. A preview endpoint that blocked for nine
  minutes would be indistinguishable from a hang.
* **No format or quality parameter.** What a preview is encoded as is a property
  of the session, chosen once by the composition root, because a panel that
  could ask for PNG would ask for it, and then wonder why scrubbing stutters.
* **No project state in the response.** A frame is a picture of the project as
  it stands; the panel already has the state, and a second copy in every frame
  response is a second thing to keep in step.

**Caching.** `Cache-Control: no-store` on every frame. A preview is not a
resource with an identity — it is a rendering of a timeline that changes while
the user is looking at it — and a proxy or a browser that kept one would show
yesterday's edit as today's truth.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status

from nova_studio.api.dependencies import media_factory, workspace
from nova_studio.api.errors import error_responses, problem_response, status_for

# Runtime, not just for typing: `isinstance` is how the handlers narrow the
# "renderer or refusal" union, and that needs the class itself. `MediaJobFactory`
# is a dependency FastAPI resolves, and a name that exists only for mypy is not
# a dependency — it is a query parameter.
from nova_studio.api.media_jobs import MediaJobFactory  # noqa: TC001 — FastAPI resolves it
from nova_studio.api.schemas.render import (
    PreviewCacheResponse,
    PreviewSourcesResponse,
    PreviewWarmRequest,
    PreviewWarmResponse,
)
from nova_studio.api.workspace import OpenProject, not_open
from nova_studio.services.render import PreviewRenderer, Viewport, plan_preview

if TYPE_CHECKING:
    from nova_studio.api.workspace import ProjectWorkspace
    from nova_studio.core.errors import NovaError
    from nova_studio.core.result import Result

__all__ = ["router"]


router = APIRouter(tags=["render"])


#: Geometry that travels beside the picture rather than inside it. Prefixed, so
#: a future proxy or gateway can see them for what they are, and so a client
#: that ignores them still gets the image.
_SCALE_HEADER: str = "X-Nova-Preview-Scale"
_OFFSET_HEADER: str = "X-Nova-Preview-Offset"
_SIZE_HEADER: str = "X-Nova-Preview-Size"
_GAPS_HEADER: str = "X-Nova-Preview-Gaps"


def _refusal(error: NovaError, path: str) -> Any:
    """One `NovaError` as one `problem+json` response, on the path it happened."""
    return problem_response(error, instance=path, status=status_for(error))


def _renderer(projects: ProjectWorkspace, project_id: str, path: str) -> PreviewRenderer | Any:
    """The renderer for one open project, or a response describing why not.

    Returning either is what keeps the frame handler flat: a miss is a response
    the router hands straight back, and a hit is the renderer the rest of the
    handler uses.
    """
    opened: Result[PreviewRenderer] = projects.preview(project_id)
    problem = opened.error()
    if problem is not None:
        return _refusal(problem, path)
    return opened.unwrap()


def _gap_ids(renderer: PreviewRenderer) -> list[str]:
    """The assets the pool could not decode, most recent first.

    Taken from the pool's errors rather than re-asked, so the number in the
    response is the number the renderer really holds — and filtered of the
    errors with no asset id, which are about the pool itself.
    """
    ids: list[str] = []
    for problem in renderer.errors():
        asset_id = problem.details.get("asset_id")
        if isinstance(asset_id, str) and asset_id not in ids:
            ids.append(asset_id)
    return ids


def _sources(
    projects: ProjectWorkspace,
    project_id: str,
    shown: OpenProject,
    *,
    viewport: Viewport,
    zoom: float,
) -> dict[str, str]:
    """Which copy of each asset this preview should decode.

    The scale is the fitted one, zoom included: a user who zoomed in asked to
    see more detail, and decoding a quarter-scale proxy into a full-screen
    preview would be the policy's promise broken at exactly the moment it
    mattered.

    Answered from the workspace rather than computed here, because which file a
    proxy *is* belongs to the media feature, and a router that knew the cache
    layout would be a second copy of it. The plan is integer arithmetic — the
    frame has not been touched yet.
    """
    size = shown.project.settings.frame_size
    plan = plan_preview(size.width, size.height, viewport, zoom=zoom)
    return dict(projects.sources_for(project_id, scale=plan.scale))


def _open_project(projects: ProjectWorkspace, project_id: str, path: str) -> OpenProject | Any:
    """The open project, or the 404 that says there is not one.

    Read again here rather than captured once: the project is a frozen value the
    workspace replaces on every edit, and a frame drawn from the copy the router
    saw at startup would be a frame of a timeline that no longer exists.
    """
    shown = projects.get(project_id)
    if shown is None:
        return _refusal(not_open(project_id), path)
    return shown


#: What a frame is, and what a failure is. Spelled out because FastAPI would
#: otherwise describe this endpoint as `application/json` with an empty schema —
#: a contract that tells the frontend to parse a JPEG as a document (and a
#: generated client that tries).
FRAME_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {
        "content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}},
        "description": "One composited frame, scaled to the panel, never up.",
    },
    **error_responses(),
}


@router.get(
    "/api/v1/projects/{project_id}/preview/frame",
    responses=FRAME_RESPONSES,
    summary="One frame of the preview, as an image",
)
def preview_frame(
    request: Request,
    project_id: str,
    frame: int = Query(0, ge=0, description="The timeline frame to draw."),
    width: int = Query(960, ge=2, description="The panel's width, in device pixels."),
    height: int = Query(540, ge=2, description="The panel's height, in device pixels."),
    zoom: float = Query(1.0, gt=0, description="A deliberate multiplier on the fitted scale."),
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Composite one frame and send it as an image.

    The frame is composited by the same code the export uses, at the project's
    own size, and scaled down to what the panel can show — never up: pixels
    above 1:1 are not information, and zoom is a display concern, not a request
    for more of them.

    A layer whose media is offline is **not** a failure: the frame is drawn
    without it and the asset ids are listed in `X-Nova-Preview-Gaps`, because a
    panel that showed an error instead of a frame would hide the nineteen clips
    that are fine.
    """
    path = request.url.path
    renderer = _renderer(projects, project_id, path)
    if not isinstance(renderer, PreviewRenderer):
        return renderer
    shown = _open_project(projects, project_id, path)
    if not isinstance(shown, OpenProject):
        return shown

    viewport = Viewport(width=width, height=height)
    result = renderer.frame(
        shown.project,
        frame,
        viewport=viewport,
        zoom=zoom,
        sources=_sources(projects, project_id, shown, viewport=viewport, zoom=zoom),
    )
    problem = result.error()
    if problem is not None:
        return _refusal(problem, path)

    picture = result.unwrap()
    headers = {
        _SCALE_HEADER: f"{picture.plan.scale:.6f}",
        _OFFSET_HEADER: f"{picture.plan.offset[0]},{picture.plan.offset[1]}",
        _SIZE_HEADER: f"{picture.width}x{picture.height}",
        # A preview is a rendering of a timeline that is being edited, not a
        # resource with an identity: nothing may keep it.
        "Cache-Control": "no-store",
    }
    if picture.gaps:
        headers[_GAPS_HEADER] = ",".join(picture.gaps)
    return Response(
        content=picture.image,
        media_type=picture.media_type,
        headers=headers,
        status_code=status.HTTP_200_OK,
    )


@router.post(
    "/api/v1/projects/{project_id}/preview/warm",
    response_model=PreviewWarmResponse,
    responses=error_responses(),
    summary="Decode ahead of the playhead",
)
def warm_preview(
    request: Request,
    project_id: str,
    body: PreviewWarmRequest,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Have the next few frames decoded before they are asked for.

    Warming is its own request rather than a side effect of :func:`preview_frame`
    because it is work the user has not asked to see: done inside the frame
    request it would add fifteen decodes of latency to the one frame being
    waited for, and done on every request it would warm the frames the user is
    scrubbing *away* from.

    The response carries the pool's `seeks`, which is the number that says
    whether scrubbing is healthy: one per clip per run, not one per frame.
    """
    path = request.url.path
    renderer = _renderer(projects, project_id, path)
    if not isinstance(renderer, PreviewRenderer):
        return renderer
    shown = projects.get(project_id)
    if shown is None:
        from nova_studio.api.workspace import not_open

        return _refusal(not_open(project_id), path)

    warmed = renderer.warm(
        shown.project,
        body.frame,
        count=body.count,
        last_frame=shown.project.timeline.duration_frames,
        # The same question the frame endpoint asks, so the warmed frames are
        # the ones the pool will be asked for — a decode is cached under the
        # copy it came from, and warming the original while previewing a proxy
        # would be fifteen decodes of nothing.
        sources=_sources(
            projects,
            project_id,
            shown,
            viewport=Viewport(width=body.width, height=body.height),
            zoom=1.0,
        ),
    )
    stats = renderer.stats
    return PreviewWarmResponse(
        frame=body.frame,
        warmed=warmed,
        cached_bytes=renderer.cached_bytes,
        open_sources=renderer.open_sources,
        seeks=stats.seeks,
        gaps=_gap_ids(renderer),
    )


@router.get(
    "/api/v1/projects/{project_id}/preview/sources",
    response_model=PreviewSourcesResponse,
    responses=error_responses(),
    summary="Which copy of each asset the preview is decoding",
)
def preview_sources(
    request: Request,
    project_id: str,
    width: int = Query(960, ge=2, description="The panel's width, in device pixels."),
    height: int = Query(540, ge=2, description="The panel's height, in device pixels."),
    zoom: float = Query(1.0, gt=0, description="A deliberate multiplier on the fitted scale."),
    factory: MediaJobFactory = Depends(media_factory),
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Say what the preview is showing, including when it is the original.

    A proxy is transparent by design: the frame endpoint answers with a picture
    whichever copy it decoded, and the panel cannot tell — which is right for a
    frame and wrong for a status line. This is the read that lets the editor say
    "decoding original" while a proxy transcodes, and it is the same question
    `POST …/media/ensure` answers with jobs, asked without starting any.

    Cheap and idempotent, so a panel may poll it: the scale is integer
    arithmetic and the pending list is one index lookup per asset on the
    timeline. Nothing is decoded and no file is opened.
    """
    path = request.url.path
    shown = projects.get(project_id)
    if shown is None:
        return _refusal(not_open(project_id), path)

    size = shown.project.settings.frame_size
    plan = plan_preview(size.width, size.height, Viewport(width=width, height=height), zoom=zoom)
    sources = projects.preview_sources(project_id, scale=plan.scale)
    pending = [
        job.asset_id
        for job in factory.plan(shown.project, projects.media_cache, proxies=True, thumbnails=False)
    ]
    return PreviewSourcesResponse(
        project_id=project_id,
        scale=plan.scale,
        sources=sources,
        pending=sorted(pending),
    )


@router.delete(
    "/api/v1/projects/{project_id}/preview/cache",
    response_model=PreviewCacheResponse,
    responses=error_responses(),
    summary="Drop the decoded pictures",
)
def clear_preview_cache(
    request: Request,
    project_id: str,
    projects: ProjectWorkspace = Depends(workspace),
) -> Any:
    """Forget what has been decoded, and keep the decoders.

    The workspace does this itself after every edit; this endpoint is for the
    other case, which is memory: a long session on a large project has a cache
    full of pictures of frames the user has finished with.

    An open decoder is a file, and the files have not changed, so they stay.
    """
    path = request.url.path
    renderer = _renderer(projects, project_id, path)
    if not isinstance(renderer, PreviewRenderer):
        return renderer
    renderer.invalidate()
    return PreviewCacheResponse(
        cleared=True,
        cached_bytes=renderer.cached_bytes,
        open_sources=renderer.open_sources,
    )
