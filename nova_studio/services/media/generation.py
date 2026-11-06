"""L3 — making the derived copies: the proxy transcode and the thumbnail stills.

`cache.py` answers *which* copy a decode should read and `proxy.py` answers
*whether* one should exist. This module is the third answer, and the one that
costs the most: **how the bytes get made**.

It is two jobs, because the two artefacts are nothing alike:

* A **proxy** is a whole clip, re-encoded smaller and cheap to seek. It takes
  minutes, costs hundreds of megabytes, and is worth exactly as much as the
  time it saves the user who is scrubbing.
* A **thumbnail** is one frame, shrunk and written as a JPEG. It takes a seek,
  costs thirty kilobytes, and a media bin without them is a list of filenames.

The asymmetry is why they reach different things: **proxies are planned for the
assets the timeline actually references**, and thumbnails for every asset in the
project. Transcoding the two hundred files somebody imported but never cut is
how a cache becomes forty gigabytes; decoding eight frames of each is how a bin
becomes browsable, and it costs less than the probe that found them.

**Jobs, not calls.** Both bodies are instances with `__call__(context)`, frozen,
holding *factories* rather than live objects, in the same shape as
`services/render/export.py`. That shape is not a stylistic echo — it is what
lets the body be pickled and run in a worker process (ADR-0010 §1), where it
opens its own decoder, its own renderer and its own cache index. Nothing
unpicklable is captured, and nothing runs on the request path: a service that
transcoded while the user was dragging a clip is how an editor earns a
reputation for freezing.

**A job that fails leaves nothing.** The renderer stages beside the target and
promotes on `finish`, and the still sink renames into place; both bodies abort
on failure, and neither records a row for bytes that are not on the disk. A
cache entry is a promise, and the promise is only made after the file exists.

**Eviction is part of admitting, not an afterthought.** A job that has just
written and recorded a file enforces the byte budget itself, naming the key it
made in `keep`: a cache nobody trims is a disk that fills up, and an artefact
evicted by the very job that made it would be a bug nobody would believe. The
*choice* is `services/media/eviction.py`'s, over the domain's
`select_for_eviction`.

**What this module does not do:** decide when to run (the scheduler, and until
it exists, the composition root), or probe (that happened at import, and every
decision here is made from the `MediaInfo` already in the project).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Final, TypeAlias

from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.jobs import (
    DEFAULT_GRACE_PERIOD_MS,
    Isolation,
    JobMemoryClass,
    JobOutcome,
    JobPriority,
    JobProgress,
    JobSpec,
    RetryPolicy,
)
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.export import (
    ContainerFormat,
    OutputSpec,
    RateControl,
    RateControlMode,
    RenderStats,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import FrameBuffer, VideoStreamInfo
from nova_studio.ports.imaging import Interpolation
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.ports.media import MediaErrorCode
from nova_studio.services.media.eviction import DEFAULT_CACHE_BUDGET, enforce_budget
from nova_studio.services.media.keys import proxy_key, thumbnail_key
from nova_studio.services.media.proxy import DEFAULT_PROXY_POLICY, ProxyPlan, ProxyPolicy
from nova_studio.services.media.thumbnails import (
    DEFAULT_STRIP_COUNT,
    snap_to_keyframe,
    thumbnail_indices,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.temporal import Timebase
    from nova_studio.domain.media import MediaAsset, MediaInfo
    from nova_studio.domain.persistence import CacheBudget
    from nova_studio.domain.project import Project
    from nova_studio.ports.clock import Clock
    from nova_studio.ports.jobs import JobContext
    from nova_studio.ports.media import MediaDecoder, VideoFrameSource
    from nova_studio.ports.render import Renderer, RenderTarget
    from nova_studio.services.media.cache import MediaCache

__all__ = [
    "DEFAULT_CACHE_BUDGET",
    "DEFAULT_THUMBNAIL_WIDTH",
    "PROGRESS_INTERVAL_MS",
    "PROXY_JOB_KIND",
    "THUMBNAIL_JOB_KIND",
    "GenerationStage",
    "ProxyJob",
    "ProxyRequest",
    "StillSink",
    "ThumbnailJob",
    "ThumbnailRequest",
    "proxy_job_spec",
    "proxy_output_spec",
    "proxy_requests",
    "thumbnail_geometry",
    "thumbnail_job_spec",
    "thumbnail_requests",
]

#: What a still-writing adapter looks like. Restated here, rather than imported
#: from `infra/preview.py`, for the same reason `cache.py` restates
#: `SourceResolver`: a feature may not import another layer's implementation,
#: and a type alias is cheaper than a port nobody else uses.
StillSink: TypeAlias = "Callable[[FrameBuffer, str], Result[int]]"

#: Factories, not collaborators: a job body is pickled and sent to a worker, so
#: everything it holds must survive the trip and be built on the other side.
RendererFactory: TypeAlias = "Callable[[], Renderer]"
OpsFactory: TypeAlias = "Callable[[], Any]"
DecoderFactory: TypeAlias = "Callable[[], MediaDecoder]"
ClockFactory: TypeAlias = "Callable[[], Clock]"
StillSinkFactory: TypeAlias = "Callable[[], StillSink]"
CacheFactory: TypeAlias = "Callable[[], MediaCache]"


class GenerationStage:
    """The names a progress report's ``stage`` carries.

    A plain class of strings, like `ExportStage`, because a stage is a label the
    frontend renders and a new one must not require a coordinated release.
    """

    PREPARING: str = "preparing"
    TRANSCODING: str = "transcoding"
    STILLS: str = "stills"
    DONE: str = "done"


#: The dotted slugs these jobs are submitted under (ADR-0010 §2).
PROXY_JOB_KIND: Final[str] = "media.proxy"
THUMBNAIL_JOB_KIND: Final[str] = "media.thumbnail"

#: How wide a media-bin tile's thumbnail is, until the panel asks otherwise.
#: 320 because that is about as wide as a tile gets with the bin open on a 4K
#: panel, and a thumbnail is decoded to be looked at, not measured.
DEFAULT_THUMBNAIL_WIDTH: Final[int] = 320

#: How often a body may publish progress. The executor throttles anyway; this is
#: the body's own budget, so a ten-minute transcode does not spend itself
#: formatting strings for a bar nobody is watching.
PROGRESS_INTERVAL_MS: Final[int] = 250

#: A cancelled transcode gets ten seconds to unwind. Less than an export's
#: thirty because a proxy holds no muxed audio and abandoning it costs only the
#: work since the last keyframe — but more than zero, because "abort" means
#: flush the encoder and remove the staging file, and neither is immediate.
PROXY_GRACE_PERIOD_MS: Final[int] = 10_000

#: What a proxy is encoded as. H.264 in Matroska, CRF 24, ``veryfast``: a proxy
#: is decoded dozens of times a second and written once, so the encoder is
#: tuned for the decode, not for the bytes. ``veryfast`` rather than a slower
#: preset because a proxy at twice the size is still a fraction of its source,
#: and a transcode that took four times as long is four times as likely to still
#: be running when the user wants to scrub.
PROXY_CODEC: Final[VideoCodec] = VideoCodec.H264
PROXY_CONTAINER: Final[ContainerFormat] = ContainerFormat.MKV
PROXY_CRF: Final[int] = 24
PROXY_PRESET: Final[str] = "veryfast"
PROXY_PIXEL_FORMAT: Final[str] = "yuv420p"

#: How long a group of pictures may be, in seconds. Not all-intra: an all-intra
#: 720p proxy is larger than the 4K original it replaces, and the point of a
#: proxy is to spend *less* on every seek, not the same. Half a second is the
#: compromise — a sparse read decodes at most fifteen cheap frames instead of
#: fifteen expensive ones.
PROXY_GOP_SECONDS: Final[float] = 0.5


# -- what to make ------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProxyRequest:
    """One asset's proxy, fully described: what to read, what to write, how.

    Built by :func:`proxy_requests` in the editor process and handed to a
    worker, which is why it carries everything and asks nothing — including the
    encode spec, so that "which codec is a proxy" is decided once, here, and
    not guessed again on the other side of a process boundary.
    """

    asset_id: str
    #: The user's file. Never a proxy: a proxy of a proxy is a generation loss
    #: nobody asked for.
    source: str
    #: Where the proxy goes. The renderer stages beside it and promotes on
    #: `finish`, so this path names a complete file or nothing at all.
    destination: str
    #: Its cache key, derived — the same asset at the same size always asks for
    #: the same name.
    key: str
    #: What to encode with.
    spec: OutputSpec
    #: Which video stream the proxy is taken from.
    source_index: int = 0

    @property
    def size(self) -> tuple[int, int]:
        """``(width, height)`` of the file this writes."""
        return (self.spec.video.width, self.spec.video.height)

    @property
    def name(self) -> str:
        """The file name, for a progress line."""
        return _basename(self.destination)


@dataclass(frozen=True, slots=True)
class ThumbnailRequest:
    """One still: which frame of which asset, at what size, under what key."""

    asset_id: str
    source: str
    destination: str
    key: str
    #: The frame the strip *asked* for. The picture is the nearest keyframe at
    #: or before it — see :func:`thumbnail_requests` for why the key still
    #: names the requested frame.
    frame: int
    width: int
    height: int


def proxy_requests(
    project: Project,
    *,
    cache: MediaCache,
    policy: ProxyPolicy = DEFAULT_PROXY_POLICY,
) -> tuple[ProxyRequest, ...]:
    """Which proxies the project needs and does not have.

    Only the assets the **timeline references**: everything else is footage the
    user imported and has not cut, and transcoding it is how a cache becomes
    forty gigabytes before anybody has scrubbed anything.

    An asset already held is not planned again, and an asset the policy says no
    about is not asked about — the policy's reasoning is its business, not the
    planner's.
    """
    requests: list[ProxyRequest] = []
    for asset in _referenced_assets(project):
        if asset.probe is None:
            continue
        plan = policy.plan(asset.probe)
        if not plan.needed:
            continue
        key = proxy_key(str(asset.asset_id), height=plan.target_height)
        if cache.has(key):
            continue
        requests.append(
            ProxyRequest(
                asset_id=str(asset.asset_id),
                source=asset.path,
                destination=str(cache.path_for(key)),
                key=key,
                spec=proxy_output_spec(asset.probe, plan),
                source_index=plan.source_index,
            )
        )
    return tuple(requests)


def thumbnail_requests(
    project: Project,
    *,
    cache: MediaCache,
    count: int = DEFAULT_STRIP_COUNT,
    width: int = DEFAULT_THUMBNAIL_WIDTH,
) -> tuple[ThumbnailRequest, ...]:
    """Which thumbnails the project needs and does not have.

    Every asset, not just the ones on the timeline: the media bin lists all of
    them, and eight decodes of a file that is never cut cost less than the probe
    that found it.

    The indices come from :func:`~nova_studio.services.media.thumbnails.thumbnail_indices`
    over the **probe's** frame count, with no keyframe list — because planning
    happens in the editor process and keyframes are only known once a decoder is
    open. The *body* then snaps each index back to a keyframe and records the
    artefact under the same key, which is honest rather than merely convenient:
    the key names the frame the strip asked for, the picture is the cheapest
    frame that stands in for it, and that mapping is a pure function of the file
    — so the same strip asks for the same names after a reopen.
    """
    requests: list[ThumbnailRequest] = []
    for asset in project.assets:
        video = asset.probe.primary_video() if asset.probe is not None else None
        if video is None or video.frame_count < 1:
            continue
        geometry = thumbnail_geometry(video, width)
        asset_id = str(asset.asset_id)
        for index in thumbnail_indices(video.frame_count, wanted=count):
            key = thumbnail_key(asset_id, frame=index, width=geometry[0])
            if cache.has(key):
                continue
            requests.append(
                ThumbnailRequest(
                    asset_id=asset_id,
                    source=asset.path,
                    destination=str(cache.path_for(key)),
                    key=key,
                    frame=index,
                    width=geometry[0],
                    height=geometry[1],
                )
            )
    return tuple(requests)


def thumbnail_geometry(video: VideoStreamInfo, width: int) -> tuple[int, int]:
    """``(width, height)`` for a thumbnail of one video stream.

    The height follows the *display* aspect ratio — sample aspect ratio and
    rotation applied — because a thumbnail of anamorphic footage that came out
    stretched is worse than no thumbnail: the user reads it as the truth about
    the frame. Both dimensions come out even, for the same reason every 4:2:0
    encoder insists on it.

    Raises:
        NovaInvariantError: On a width below two, which is a bug in the caller.
    """
    if width < 2:
        raise NovaInvariantError(f"a thumbnail must be at least 2 pixels wide, got {width}")
    height = round(width * video.display_height / max(1, video.display_width))
    height -= height % 2
    return (width - width % 2, max(2, height))


def proxy_output_spec(info: MediaInfo, plan: ProxyPlan) -> OutputSpec:
    """The encode spec for one proxy.

    The timebase is the **source's**, not the project's: a proxy is
    frame-for-frame the same clip, and a proxy at a different rate is a retime
    nobody asked for. The GOP is half a second of the source's own rate, so a
    seek costs the same fraction of a second whatever the footage is.

    Raises:
        NovaInvariantError: When there is no video stream to proxy. The planner
            only calls this after ``ProxyPolicy.plan`` said ``needed``, and
            "needed" already means a video stream exists — so reaching here is
            a bug in the caller, not a property of the footage.
    """
    video = info.stream(plan.source_index)
    if not isinstance(video, VideoStreamInfo):
        video = info.primary_video()
    if video is None:
        raise NovaInvariantError(
            f"no video stream to proxy in a {info.kind} file: the policy should "
            f"have said a proxy was not needed"
        )
    timebase: Timebase = video.timebase
    gop = max(1, round(timebase.fps * PROXY_GOP_SECONDS))
    return OutputSpec(
        container=PROXY_CONTAINER,
        video=VideoEncodeSpec(
            codec=PROXY_CODEC,
            width=plan.target_width,
            height=plan.target_height,
            timebase=timebase,
            rate_control=RateControl(mode=RateControlMode.CRF, crf=PROXY_CRF),
            pixel_format=PROXY_PIXEL_FORMAT,
            gop_size=gop,
            preset=PROXY_PRESET,
        ),
    )


def proxy_job_spec(
    *, priority: JobPriority = JobPriority.NORMAL, dedupe_key: str | None = None
) -> JobSpec:
    """The declaration a proxy job is submitted under.

    Normal priority and **process** isolation: a transcode is minutes of CPU,
    and on the thread pool it would starve the UI (ADR-0010 §1). It is
    idempotent — writing the same proxy twice is the same as writing it once —
    which is what makes a retry after a lost worker safe. ``dedupe_key`` is how
    twenty panels asking for the same clip share one job instead of queuing
    twenty transcodes.
    """
    return JobSpec(
        kind=PROXY_JOB_KIND,
        priority=priority,
        isolation=Isolation.PROCESS,
        memory_class=JobMemoryClass.LARGE,
        cancellable=True,
        idempotent=True,
        grace_period_ms=PROXY_GRACE_PERIOD_MS,
        retry=RetryPolicy(),
        dedupe_key=dedupe_key,
    )


def thumbnail_job_spec(
    *, priority: JobPriority = JobPriority.NORMAL, dedupe_key: str | None = None
) -> JobSpec:
    """The declaration a thumbnail job is submitted under.

    A **thread** rather than a process, and a small memory class: eight seeks
    and eight JPEGs is milliseconds of work, and spawning a process to do it
    would cost more than the job — `spawn` is ~300 ms on Windows (ADR-0010 §1).
    """
    return JobSpec(
        kind=THUMBNAIL_JOB_KIND,
        priority=priority,
        isolation=Isolation.THREAD,
        memory_class=JobMemoryClass.SMALL,
        cancellable=True,
        idempotent=True,
        grace_period_ms=DEFAULT_GRACE_PERIOD_MS,
        dedupe_key=dedupe_key,
    )


# -- the work ----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProxyJob:
    """Transcode one asset into its proxy, as a job body.

    Call it with a :class:`~nova_studio.ports.jobs.JobContext`. Every
    collaborator is a factory called **inside** the run, so the body is
    picklable and the worker builds its own decoder, renderer, pixel operations
    and cache index on its own side of the process boundary.

    **Cancellation** is polled between frames: the loop stops, the target is
    aborted and the job ends as ``Err(NS-JOB-5005)`` — which the UI shows as
    "stopped", not "failed", because the user asked for it.

    **Failure leaves no file and no row.** The renderer stages beside the
    target; aborting removes it. Only a finished, promoted file is recorded in
    the cache, because a row is a promise eviction will collect on, and bytes
    no row names are bytes nobody can reclaim.

    Attributes:
        request: What to read, what to write, and how to encode it.
        renderer_factory: How to open the output. Called once, in the worker.
        ops_factory: The pixel primitives the transcode resamples with.
        decoder_factory: How to open the original.
        cache_factory: The cache index the finished file is recorded in. Built
            in the worker, because a SQLite connection cannot be pickled.
        clock_factory: For progress throttling and elapsed time.
        report_every_ms: How often progress may be published.
    """

    request: ProxyRequest
    renderer_factory: RendererFactory
    ops_factory: OpsFactory
    decoder_factory: DecoderFactory
    cache_factory: CacheFactory
    clock_factory: ClockFactory | None = None
    report_every_ms: int = PROGRESS_INTERVAL_MS
    #: How much derived data the install will keep. Admission is the moment to
    #: enforce it, and the key just written is named in `keep` so it survives.
    budget: CacheBudget = DEFAULT_CACHE_BUDGET

    def __call__(self, context: JobContext) -> Result[JobOutcome]:
        """Decode the original, scale it, encode the proxy, record it."""
        clock = (self.clock_factory or SystemClock)()
        request = self.request
        progress = _Progress(context, clock, every_ms=self.report_every_ms)
        progress.emit(
            _forced(
                GenerationStage.PREPARING, f"{request.name} → {request.size[0]}x{request.size[1]}"
            )
        )

        opened = self.decoder_factory().open(request.source)
        if opened.is_err():
            return err(opened.unwrap_err())
        media = opened.unwrap()
        source = media.video(request.source_index)
        if source is None:
            media.close()
            return err(_no_video(request.source))

        opened_target = self.renderer_factory().open(request.spec, request.destination)
        if opened_target.is_err():
            media.close()
            return err(opened_target.unwrap_err())
        target = opened_target.unwrap()

        try:
            transcoded = self._transcode(source, target, context, progress)
        finally:
            media.close()

        if transcoded.is_err():
            target.abort()
            return err(transcoded.unwrap_err())

        # The container's commit point: the loop finished the *stream*, which
        # flushed the encoder; this writes the index and promotes the staged
        # file, and a proxy is only readable after it.
        progress.emit(_forced(GenerationStage.TRANSCODING, request.name, fraction=1.0))
        finishing = target.finish()
        if finishing.is_err():
            target.abort()
            return err(finishing.unwrap_err())
        stats = finishing.unwrap()

        cache = self.cache_factory()
        recorded = cache.record(request.key, size_bytes=stats.bytes_written)
        if recorded.is_err():
            # The file is complete but no row names it, so nobody will find it
            # and eviction cannot reclaim it. Deleting is the only honest
            # ending: a failed job must not leave bytes behind.
            cache.forget(request.key)
            return err(recorded.unwrap_err())

        _trim(cache, self.budget, keep=request.key)
        detail = _proxy_summary(stats, request)
        progress.emit(_forced(GenerationStage.DONE, detail))
        return ok(JobOutcome(value=stats, artefacts=(request.destination,), detail=detail))

    # -- internals -----------------------------------------------------------

    def _transcode(
        self,
        source: VideoFrameSource,
        target: RenderTarget,
        context: JobContext,
        progress: _Progress,
    ) -> Result[int]:
        """Every frame, in order. Returns the count written."""
        ops = self.ops_factory()
        sink = target.video()
        size = self.request.size
        progress.total = int(source.frame_count())
        written = 0
        for frame in source.frames():
            if context.is_cancelled():
                return err(_cancelled("proxy", written))
            scaled = FrameBuffer(
                pixels=ops.resize(frame.pixels, size, interpolation=Interpolation.AREA),
                colour=frame.colour,
            )
            result = sink.write(scaled)
            if result.is_err():
                return err(result.unwrap_err())
            written += 1
            progress.tick(written, stage=GenerationStage.TRANSCODING, detail=self.request.name)

        # An iterator has no `Result` channel: a failure mid-stream is latched
        # on the source and read once, here, where the loop has ended.
        failure = source.last_error()
        if failure is not None:
            return err(failure)
        if written == 0:
            return err(_empty(request=self.request))
        return ok(written)


@dataclass(frozen=True, slots=True)
class ThumbnailJob:
    """Decode the stills for one asset and write them, as a job body.

    One job per asset rather than one per picture: the expensive part is opening
    the container, and eight frames from one open handle is eight seeks rather
    than eight opens.

    Each still is written by an injected sink that renames into place, so a
    reader never sees a half-written JPEG, and each is recorded in the cache as
    it lands — a job interrupted after five stills has left five thumbnails the
    panel can show, which is better than none.
    """

    asset_id: str
    source: str
    requests: tuple[ThumbnailRequest, ...]
    decoder_factory: DecoderFactory
    ops_factory: OpsFactory
    still_factory: StillSinkFactory
    cache_factory: CacheFactory
    clock_factory: ClockFactory | None = None
    report_every_ms: int = PROGRESS_INTERVAL_MS
    #: How much derived data the install will keep. Enforced once, after the
    #: last still of the strip, rather than per picture: eight eviction passes
    #: to admit eight JPEGs would be eight times the work for no difference.
    budget: CacheBudget = DEFAULT_CACHE_BUDGET

    def __call__(self, context: JobContext) -> Result[JobOutcome]:
        """Seek to each frame, scale it, write it, record it."""
        clock = (self.clock_factory or SystemClock)()
        total = len(self.requests)
        progress = _Progress(context, clock, total=total, every_ms=self.report_every_ms)
        progress.emit(_forced(GenerationStage.PREPARING, f"{total} thumbnail(s)", fraction=0.0))

        opened = self.decoder_factory().open(self.source)
        if opened.is_err():
            return err(opened.unwrap_err())
        media = opened.unwrap()
        handle = media.video()
        if handle is None:
            media.close()
            return err(_no_video(self.source))

        written: list[str] = []
        try:
            still = self.still_factory()
            ops = self.ops_factory()
            keyframes = tuple(int(index) for index in handle.keyframe_indices())
            cache = self.cache_factory()
            for done, request in enumerate(self.requests, start=1):
                if context.is_cancelled():
                    return err(_cancelled("thumbnails", done - 1))
                saved = self._one(handle, ops, still, request, keyframes)
                if saved.is_err():
                    return err(saved.unwrap_err())
                recorded = cache.record(request.key, size_bytes=saved.unwrap())
                if recorded.is_err():
                    cache.forget(request.key)
                    return err(recorded.unwrap_err())
                written.append(request.destination)
                progress.tick(done, stage=GenerationStage.STILLS, detail=f"frame {request.frame}")
        finally:
            media.close()

        _trim(cache, self.budget, keep=frozenset(request.key for request in self.requests))
        detail = f"{len(written)} thumbnail(s)"
        progress.emit(_forced(GenerationStage.DONE, detail))
        return ok(JobOutcome(value=len(written), artefacts=tuple(written), detail=detail))

    # -- internals -----------------------------------------------------------

    def _one(
        self,
        handle: VideoFrameSource,
        ops: Any,
        still: StillSink,
        request: ThumbnailRequest,
        keyframes: tuple[int, ...],
    ) -> Result[int]:
        """Decode one frame and write it. Returns the bytes it cost."""
        # Snap backwards to a keyframe when the decoder published them: a sparse
        # seek into long-GOP footage costs a whole group of pictures, and at
        # thumbnail scale the difference between frame 900 and frame 897 is
        # invisible. The key still names 900, and always will — see
        # `thumbnail_requests`.
        index = snap_to_keyframe(request.frame, keyframes) if keyframes else request.frame
        frame = handle.frame_at(index)
        if frame is None:
            failure = handle.last_error()
            if failure is not None:
                return err(failure)
            return err(_missing_frame(request, index))
        scaled = FrameBuffer(
            pixels=ops.resize(
                frame.pixels,
                (request.width, request.height),
                interpolation=Interpolation.AREA,
            ),
            colour=frame.colour,
        )
        return still(scaled, request.destination)


# -- progress ----------------------------------------------------------------


@dataclass(slots=True)
class _Progress:
    """Throttled progress, so a transcode does not spend itself reporting.

    A stage change and the terminal report are never dropped: a bar that sits
    still while the stage changes looks hung, and the last report is the one
    that closes the row in the job history.
    """

    context: JobContext
    clock: Clock
    total: int = 0
    every_ms: int = PROGRESS_INTERVAL_MS
    last_ms: int = field(default=0, init=False)
    stage: str = field(default=GenerationStage.PREPARING, init=False)

    def tick(self, done: int, *, stage: str, detail: str = "") -> None:
        """Report, unless this stage reported very recently and is not done."""
        now = self.clock.now_ms()
        at_end = bool(self.total) and done >= self.total
        if stage == self.stage and not at_end and now - self.last_ms < self.every_ms:
            return
        self.last_ms = now
        self.stage = stage
        self.emit(JobProgress(fraction=self._fraction(done), stage=stage, detail=detail))

    def emit(self, progress: JobProgress) -> None:
        """Publish one report, unthrottled."""
        self.context.report(progress)

    def _fraction(self, done: int) -> float:
        if not self.total:
            # A container that does not report a frame count gets a bar that
            # moves by stage instead of by frame, which is honest.
            return 0.0
        return min(1.0, done / self.total)


def _forced(stage: str, detail: str, *, fraction: float = 1.0) -> JobProgress:
    """A report that is never throttled: a stage change, or the last one."""
    return JobProgress(fraction=fraction, stage=stage, detail=detail)


# -- messages ----------------------------------------------------------------


def _trim(cache: MediaCache, budget: CacheBudget, *, keep: str | frozenset[str]) -> None:
    """Bring the cache back within budget, and say nothing about it.

    Eviction is housekeeping, so a failure here is *counted by the report and
    swallowed*: a job that made a perfectly good proxy must not fail because an
    unrelated entry could not be deleted. The bytes are on the disk either way,
    and the next admission will try again.
    """
    enforce_budget(
        cache,
        budget,
        keep=frozenset({keep}) if isinstance(keep, str) else keep,
    )


def _proxy_summary(stats: RenderStats, request: ProxyRequest) -> str:
    """One line for the job history row."""
    return (
        f"{request.name}: {stats.frames_written} frames, {stats.bytes_written / 1_048_576:.1f} MB"
    )


def _no_video(path: str) -> NovaError:
    return NovaError(
        MediaErrorCode.UNSUPPORTED,
        "this media file has no video stream",
        details={"path": path},
    )


def _missing_frame(request: ThumbnailRequest, index: int) -> NovaError:
    return NovaError(
        MediaErrorCode.DECODE_FAILED,
        f"frame {index} could not be decoded",
        details={"asset_id": request.asset_id, "frame": index},
    )


def _empty(*, request: ProxyRequest) -> NovaError:
    return NovaError(
        MediaErrorCode.DECODE_FAILED,
        "the file produced no frames to transcode",
        details={"path": request.source, "asset_id": request.asset_id},
    )


def _cancelled(what: str, done: int) -> NovaError:
    return NovaError(
        JobErrorCode.CANCELLED,
        f"{what} generation stopped after {done}",
        remedy="Nothing was written; the work starts again the next time it is needed.",
        details={"done": done},
    )


def _referenced_assets(project: Project) -> tuple[MediaAsset, ...]:
    """The assets the timeline actually uses, in timeline order, once each.

    A clip is the only thing that can make a proxy worth having: an asset that
    is not on a timeline is not being scrubbed, and the timeline — not the
    import folder — is where the user's attention is.
    """
    wanted: list[str] = []
    for track in project.timeline.tracks:
        for clip in track.clips:
            if clip.asset_id not in wanted:
                wanted.append(clip.asset_id)
    assets: list[MediaAsset] = []
    for asset_id in wanted:
        asset = project.asset(asset_id)
        if asset is not None:
            assets.append(asset)
    return tuple(assets)


def _basename(path: str) -> str:
    """The file name, not the whole path: a progress bar is three lines long."""
    return path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
