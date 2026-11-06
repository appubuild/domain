"""L4 — the media job factory: the one place that knows what a worker needs.

A proxy transcode and a thumbnail strip are the same shape of work as an export:
they cross a process boundary, so the body has to be **picklable** — data and
module-level names, no open handles, no locks, no bound methods of a live object.
`ProxyJob` and `ThumbnailJob` hold their collaborators as factories for exactly
that reason, but something still has to choose *which* factories, and choosing
adapters is composition, which belongs to the outermost ring.

So this module is the media twin of `exports.py`:

```
   routers/media.py  ──▶  MediaJobFactory  ──▶  ProxyJob / ThumbnailJob
      (HTTP words)        (which adapters)         (picklable data)
```

**Why the cache is a factory and not the workspace's.** `ProjectWorkspace.media_cache`
is a live object holding a SQLite connection and a lock; it cannot be pickled and
would not work on the other side if it could. The worker builds its own index
from `data_dir` instead — the file is WAL, so a reader in another process is
ordinary rather than exceptional.

**Why the inner functions are module-level.** A lambda is not picklable by
value; a module-level function is pickled *by name*. `new_decoder` and its
siblings live at module scope and the factory only names them, so what travels
to the worker is a few qualified names, a path and the request.

**Why planning happens here and not in the router.** "What is missing" is a
question about the project *and* the cache, and the answer is a list of
`(spec, body)` pairs the router then submits. Keeping it here means the router
stays a transport: it maps HTTP words to one call, and maps the answer back.

**Why the budget is chosen here.** A job enforces it the moment it admits bytes,
and the budget is a property of the install, not of a request — so it is bound
once, at startup, and carried into every body. A worker that had to look it up
would need a settings service it does not have.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Final

from nova_studio.core.clock import SystemClock
from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.infra.media import PyAVDecoder
from nova_studio.infra.persistence.cache import open_shared_cache_index
from nova_studio.infra.persistence.paths import (
    cache_database_path,
    cache_root,
    ensure_cache_layout,
)
from nova_studio.infra.preview import still_sink
from nova_studio.infra.render import PyAVRenderer
from nova_studio.services.media import DEFAULT_CACHE_BUDGET, MediaCache
from nova_studio.services.media.generation import (
    ClockFactory,
    DecoderFactory,
    OpsFactory,
    ProxyJob,
    RendererFactory,
    StillSinkFactory,
    ThumbnailJob,
    proxy_job_spec,
    proxy_requests,
    thumbnail_job_spec,
    thumbnail_requests,
)

if TYPE_CHECKING:
    from nova_studio.core.jobs import JobSpec
    from nova_studio.domain.persistence import CacheBudget
    from nova_studio.domain.project import Project
    from nova_studio.infra.preview import StillSink
    from nova_studio.ports.imaging import ImageOps
    from nova_studio.ports.media import MediaDecoder
    from nova_studio.ports.render import Renderer
    from nova_studio.services.media.generation import (
        ClockFactory,
        DecoderFactory,
        OpsFactory,
        ProxyRequest,
        RendererFactory,
        StillSinkFactory,
        ThumbnailRequest,
    )

__all__ = [
    "THUMBNAIL_QUALITY",
    "MediaJobFactory",
    "PlannedJob",
    "new_cache",
    "new_decoder",
    "new_ops",
    "new_renderer",
    "new_still",
]

#: JPEG quality for a generated thumbnail. Lower than the preview's 80: a
#: thumbnail is looked at for a fifth of a second at a fifth of the size, and
#: the bytes are kept for the life of the project rather than for one frame.
THUMBNAIL_QUALITY: Final[int] = 78


def new_renderer() -> Renderer:
    """Open the real encoder — in the worker, not in the process that queued it.

    Module-level, so the body that names it pickles as
    ``nova_studio.api.media_jobs.new_renderer`` and the worker imports it back.
    """
    return PyAVRenderer()


def new_ops() -> ImageOps:
    """The pixel primitives a transcode resamples with."""
    return OpenCVImageOps()


def new_decoder() -> MediaDecoder:
    """Open the real decoder — in the worker, so the handles are the worker's."""
    return PyAVDecoder()


def new_still() -> StillSink:
    """Encode one frame and leave it at a path, atomically."""
    return still_sink(quality=THUMBNAIL_QUALITY)


def new_cache(data_dir: Path) -> MediaCache:
    """The worker's own view of the install-wide cache.

    Shared, because a job thread and the request threads read the same index —
    and the directory is ensured first, because a worker handed a path cannot
    create the directory it was promised.
    """
    ensure_cache_layout(data_dir)
    return MediaCache(
        index=open_shared_cache_index(cache_database_path(data_dir)),
        root=cache_root(data_dir),
        clock=SystemClock(),
        exists=_file_exists,
        unlink=_unlink_if_there,
    )


def _file_exists(path: str) -> bool:
    return Path(path).is_file()


def _unlink_if_there(path: str) -> None:
    """Delete a file, and do not mind one that is already gone."""
    with suppress(FileNotFoundError):
        Path(path).unlink()


@dataclass(frozen=True, slots=True)
class PlannedJob:
    """One unit of work the router can submit, described well enough to report.

    The router needs three things and the body needs four, so this carries both
    without either side importing the other's vocabulary.
    """

    #: What it is, and what it may cost.
    spec: JobSpec
    #: The work. Picklable, and built to be.
    body: ProxyJob | ThumbnailJob
    #: ``proxy`` or ``thumbnail`` — the word the client sees.
    kind: str
    #: The asset it is for, so a panel can match a job to a row.
    asset_id: str
    #: How many artefacts it will produce: one proxy, or a strip of eight.
    count: int


@dataclass(frozen=True, slots=True)
class MediaJobFactory:
    """Builds the bodies of the jobs that make derived media.

    Frozen and holding no mutable state: built once per session, handed to every
    request, so two requests in flight cannot change each other's adapters.

    Attributes:
        data_dir: Where this install keeps its derived bytes. A worker builds
            its own cache index from it.
        renderer: How to open an output file. Called inside the job.
        ops: The pixel primitives a transcode resamples with.
        decoder: How to open the original.
        still: How to encode and write one still.
        budget: How much derived data the install will keep. Carried into every
            body, because the moment bytes are admitted is the moment to
            enforce it — and a job that knows the budget cannot forget it.
    """

    data_dir: Path
    renderer: RendererFactory = field(default_factory=lambda: new_renderer)
    ops: OpsFactory = field(default_factory=lambda: new_ops)
    decoder: DecoderFactory = field(default_factory=lambda: new_decoder)
    still: StillSinkFactory = field(default_factory=lambda: new_still)
    clock: ClockFactory = field(default_factory=lambda: SystemClock)
    budget: CacheBudget = DEFAULT_CACHE_BUDGET

    def plan(
        self,
        project: Project,
        cache: MediaCache,
        *,
        proxies: bool = True,
        thumbnails: bool = True,
    ) -> tuple[PlannedJob, ...]:
        """What is missing, as jobs ready to submit.

        Asked as often as it likes: an artefact already held is simply not
        planned, which is what makes this idempotent and safe to call on a
        timer, an import, or a panel repaint.

        Thumbnails are grouped **per asset** — one job, one container open,
        eight seeks — because that is the difference between a strip and eight
        jobs that each reopen the file.
        """
        planned: list[PlannedJob] = []
        if proxies:
            planned.extend(self._proxy(request) for request in proxy_requests(project, cache=cache))
        if thumbnails:
            planned.extend(
                self._thumbnails(asset_id, source, requests)
                for asset_id, source, requests in _group(thumbnail_requests(project, cache=cache))
            )
        return tuple(planned)

    # -- internals -----------------------------------------------------------

    def _proxy(self, request: ProxyRequest) -> PlannedJob:
        return PlannedJob(
            spec=proxy_job_spec(dedupe_key=f"proxy:{request.key}"),
            body=ProxyJob(
                request=request,
                renderer_factory=self.renderer,
                ops_factory=self.ops,
                decoder_factory=self.decoder,
                cache_factory=partial(new_cache, self.data_dir),
                clock_factory=self.clock,
                budget=self.budget,
            ),
            kind="proxy",
            asset_id=request.asset_id,
            count=1,
        )

    def _thumbnails(
        self,
        asset_id: str,
        source: str,
        requests: tuple[ThumbnailRequest, ...],
    ) -> PlannedJob:
        return PlannedJob(
            spec=thumbnail_job_spec(dedupe_key=f"thumbnail:{asset_id}"),
            body=ThumbnailJob(
                asset_id=asset_id,
                source=source,
                requests=requests,
                decoder_factory=self.decoder,
                ops_factory=self.ops,
                still_factory=self.still,
                cache_factory=partial(new_cache, self.data_dir),
                clock_factory=self.clock,
                budget=self.budget,
            ),
            kind="thumbnail",
            asset_id=asset_id,
            count=len(requests),
        )


def _group(
    requests: tuple[ThumbnailRequest, ...],
) -> tuple[tuple[str, str, tuple[ThumbnailRequest, ...]], ...]:
    """One group per asset, in the order the assets first appear."""
    order: list[str] = []
    by_asset: dict[str, list[ThumbnailRequest]] = {}
    sources: dict[str, str] = {}
    for request in requests:
        if request.asset_id not in by_asset:
            order.append(request.asset_id)
            by_asset[request.asset_id] = []
            sources[request.asset_id] = request.source
        by_asset[request.asset_id].append(request)
    return tuple((asset_id, sources[asset_id], tuple(by_asset[asset_id])) for asset_id in order)
