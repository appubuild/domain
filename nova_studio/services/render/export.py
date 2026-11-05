"""The export job: one project, one range, one file, reported honestly.

Everything else in this feature answers "what does this frame look like?".
This module answers the question a user actually asks of an export, which is
"**how long is this going to take, and can I stop it?**" — and it answers both
by being a *job body*: a callable that takes a
:class:`~nova_studio.ports.jobs.JobContext` and returns a
``Result[JobOutcome]``. Nothing here knows what a thread is, what a process
is, or how progress reaches a window (ADR-0010 §1). That is the whole point:

* **It stops because it is asked, not because it is killed.** The loop polls
  ``context.is_cancelled`` once per frame and stops *between* frames; the sink's
  ``abort`` then removes the partial file. A half-written frame is worse than a
  frame that was never started, and a truncated-but-playable MP4 on the user's
  desktop is worse than neither.
* **It reports in values, not in callbacks.** :class:`~nova_studio.core.jobs.JobProgress`
  is a frozen dataclass the executor throttles to 20 Hz (ADR-0010 §3). An export
  that reported through a closure into the UI could not run in another process,
  and a UI that polled a job would be the refresh-timer UI ADR-0010 §7 rules
  out.
* **It is data, so it can cross a process boundary.** An export is CPU-bound for
  minutes or hours: it runs in the process pool (ADR-0010 §1), and Windows
  ``spawn`` re-imports the worker and re-pickles the payload. So this is a
  frozen dataclass of frozen values and *module-level factories*, and it builds
  its decoders, its renderer and its clock **inside** the worker. A body that
  captured an open decoder would be refused at submit time — which is the good
  failure, because the alternative is a pickling error forty minutes into a
  two-hour export.

The composition root supplies those factories (services do not import ``infra``,
ADR-0002 rule 2), which is also what makes this testable: a test hands it a
fake sink and a counting clock and calls it directly, with no executor, no
FFmpeg and no thread in sight.

**What a gap means here.** An offline asset is not a failure: the frame is
rendered without the layer, the ids are reported in the progress payload and in
the outcome's ``detail``, and the file is written. Refusing to export a project
with one unplugged drive is refusing to export nineteen clips that are fine —
which is ADR-0015 rule 3 at the point where it costs the user an hour. An export
that *must* be complete sets ``fail_on_missing``, and then the same situation is
a refusal before the first frame is decoded.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypeAlias

from nova_studio.core.clock import SystemClock
from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.jobs import (
    Isolation,
    JobFailureKind,
    JobMemoryClass,
    JobOutcome,
    JobPriority,
    JobProgress,
    JobSpec,
    RetryPolicy,
)
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.export import OutputSpec, RenderStats
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.ports.render import RenderErrorCode
from nova_studio.services.render.loop import render_frames
from nova_studio.services.render.pool import FrameSourcePool, SourceResolver
from nova_studio.services.render.preview import resolve_asset

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.domain.media import FrameBuffer
    from nova_studio.domain.project import Project
    from nova_studio.ports.clock import Clock
    from nova_studio.ports.jobs import JobContext
    from nova_studio.ports.media import MediaDecoder
    from nova_studio.ports.render import FrameSink, Renderer
    from nova_studio.services.render.loop import RenderOutcome

__all__ = [
    "EXPORT_CACHE_BYTES",
    "EXPORT_CHECKPOINT_EVERY",
    "EXPORT_GRACE_PERIOD_MS",
    "EXPORT_JOB_KIND",
    "EXPORT_OPEN_SOURCES",
    "ExportRequest",
    "ExportStage",
    "ExportVideoJob",
    "RendererFactory",
    "export_job_spec",
    "export_params_hash",
    "export_summary",
]


#: The dotted slug every export job is recorded and circuit-broken under
#: (ADR-0010 §2): one cap, one breaker and one history row per *kind*, not per
#: file the user happened to pick.
EXPORT_JOB_KIND: str = "export.video"

#: How many decoders an export may hold open. One per clip in the frame, in
#: practice, and a timeline that cuts between six angles needs six.
EXPORT_OPEN_SOURCES: int = 8

#: How much decoded picture an export may hold. Deliberately smaller than the
#: preview's: a forward export reads every frame exactly once, so a large cache
#: is memory spent to avoid work that will not happen. Transitions still read a
#: frame twice, which is why this is not zero.
EXPORT_CACHE_BYTES: int = 16 * 1024 * 1024

#: How often a resume point is written, in frames. A two-hour export that
#: crashes at minute ninety resumes from the last one (ADR-0010 §6), and a
#: checkpoint every frame would be a disk write per frame.
EXPORT_CHECKPOINT_EVERY: int = 120

#: How long a cancelled export has before the watchdog reaps its worker. The
#: default five seconds is not enough: killing a job mid-mux is how a corrupt
#: container gets written, so an export gets the ADR's export allowance.
EXPORT_GRACE_PERIOD_MS: int = 30_000

#: A factory the worker calls to build its own infra, rather than receiving a
#: built object it cannot pickle.
RendererFactory: TypeAlias = "Callable[[], Renderer]"
OpsFactory: TypeAlias = "Callable[[], Any]"
DecoderFactory: TypeAlias = "Callable[[], MediaDecoder]"
ClockFactory: TypeAlias = "Callable[[], Clock]"
ResolveFactory: TypeAlias = "Callable[[Project], SourceResolver]"


class ExportStage:
    """The names a progress report's ``stage`` carries.

    Not an enum, because a stage is a string the frontend renders and a new one
    must not require a coordinated release: an unknown stage is shown as a
    label, not rejected.
    """

    PREPARING: str = "preparing"
    ENCODING: str = "encoding"
    MUXING: str = "muxing"
    DONE: str = "done"


@dataclass(frozen=True, slots=True)
class ExportRequest:
    """One export: which frames of which project, into what, and where.

    A value, because it is what the export dialog edits, what the job history
    lists, and what has to survive being pickled into a worker process. It
    carries the *destination* — :class:`~nova_studio.domain.export.OutputSpec`
    deliberately does not (§7.7) — because where the bytes go is a property of
    the job, not of the format.
    """

    #: Where the file goes. Absolute: a job's working directory is not the
    #: user's, and especially not in a spawned worker.
    path: str
    #: Container, codecs and rate control.
    spec: OutputSpec
    #: First timeline frame, inclusive.
    start_frame: int = 0
    #: Last timeline frame, **exclusive**. ``None`` means the end of the
    #: project, resolved when the job runs rather than when it was queued: a
    #: user who trims the last clip after starting an export expects the export
    #: to follow, not to hold a frame count from three edits ago.
    end_frame: int | None = None
    #: Whether an offline asset refuses the export. ``False`` — render with
    #: holes and report them — because most projects being exported have at
    #: least one drive that is not plugged in.
    fail_on_missing: bool = False

    def __post_init__(self) -> None:
        if not self.path:
            raise NovaInvariantError("an export needs a destination path")
        if self.start_frame < 0:
            raise NovaInvariantError(f"start_frame must not be negative, got {self.start_frame}")
        if self.end_frame is not None and self.end_frame < self.start_frame:
            raise NovaInvariantError(
                f"end_frame ({self.end_frame}) must not precede start_frame ({self.start_frame})"
            )

    def frames_for(self, project: Project) -> range:
        """The frames this export renders, resolved against the project.

        Raises:
            `NovaInvariantError` when the range is empty: an export of no
            frames is a request nobody meant to make, and discovering it after
            a worker has been scheduled is the worst time.
        """
        duration = project.timeline.duration_frames
        end = duration if self.end_frame is None else min(self.end_frame, duration)
        if end <= self.start_frame:
            raise NovaInvariantError(
                f"nothing to export: frames [{self.start_frame}, {end}) of a "
                f"{duration}-frame project"
            )
        return range(self.start_frame, end)


def export_job_spec(*, priority: JobPriority = JobPriority.LOW) -> JobSpec:
    """The declaration every export job is submitted under.

    One function rather than a constant, because the spec encodes decisions a
    caller may need to see: an export is **CPU-bound for minutes**, so it runs
    in the process pool (ADR-0010 §1) where the UI thread cannot be starved by
    it; it is **low priority**, because a user who is exporting is usually also
    editing; and it is **idempotent**, because writing the same file twice is
    the same as writing it once, which is what makes a retry after a lost
    worker safe (a retried non-idempotent job is silent corruption).
    """
    return JobSpec(
        kind=EXPORT_JOB_KIND,
        priority=priority,
        isolation=Isolation.PROCESS,
        memory_class=JobMemoryClass.LARGE,
        cancellable=True,
        idempotent=True,
        grace_period_ms=EXPORT_GRACE_PERIOD_MS,
        retry=RetryPolicy(
            max_attempts=2,
            retry_on=frozenset({JobFailureKind.WORKER_LOST}),
        ),
    )


def export_summary(stats: RenderStats, *, missing: tuple[str, ...] = ()) -> str:
    """One line for the job history row: what was written, and what was not.

    Frames, bytes and observed throughput are what a user recognises. The
    throughput is the number that makes the *next* estimate honest, and the
    missing-asset count is the one that explains why the picture has holes.
    """
    text = f"{stats.frames_written} frames · {_bytes(stats.bytes_written)}"
    if stats.elapsed_ms > 0:
        text += f" · {stats.frames_per_second:.1f} fps"
    if missing:
        noun = "asset" if len(missing) == 1 else "assets"
        text += f" · {len(missing)} {noun} offline"
    return text


def export_params_hash(request: ExportRequest) -> str:
    """A short fingerprint of *what was asked for*, not of what was produced.

    Two rows in the job history carrying the same hash are the same export
    asked twice, which is what lets a panel say "run again" instead of making
    the user wonder whether the second row differs from the first.

    Deliberately **not** a hash of the project: the project changes between two
    exports of the same settings, and a fingerprint that moved with it would
    answer a question nobody asked ("did anything change?", to which the answer
    is always yes). This answers "same destination, same settings, same range".
    """
    video = request.spec.video
    parts = (
        request.path,
        str(request.spec.container),
        str(video.codec),
        str(video.width),
        str(video.height),
        str(video.timebase.num) if video.timebase else "0",
        str(video.timebase.den) if video.timebase else "0",
        str(video.rate_control.crf) if video.rate_control.crf is not None else "",
        str(video.rate_control.bit_rate) if video.rate_control.bit_rate is not None else "",
        str(request.start_frame),
        str(request.end_frame),
    )
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]


def _bytes(count: int) -> str:
    """A size a human reads without counting digits."""
    value = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"  # pragma: no cover — the loop covers every unit


def _resolver_for(project: Project) -> SourceResolver:
    """``(asset_id, source) -> path`` for one project, bound at run time.

    The default, and a module-level function so that a job body carrying it can
    be pickled: the media layer will supply a richer one — proxy and thumbnail
    paths, resolved by a :class:`~nova_studio.services.media.proxy.ProxyPolicy`
    — and this is the shape it has to have.
    """

    def resolve(asset_id: str, source: str) -> str | None:
        return resolve_asset(project, asset_id, source)

    return resolve


class _ProgressSink:
    """A `FrameSink` that counts what it wrote and says so.

    Progress belongs here rather than in the loop: the loop's job is to render
    frames in order, and a loop that also knew how many frames were left, how
    fast they were going and what to call would be three components wearing one
    coat. Wrapping the sink keeps the loop unchanged and puts the reporting
    exactly where the thing being counted happens — after a successful write,
    which is the only count a user cares about.

    It aborts, too, because a sink that decorated `write` but not `abort` would
    leave the inner stream un-aborted on failure, and an un-aborted render is a
    partial file with a plausible name.
    """

    def __init__(
        self,
        inner: FrameSink,
        *,
        context: JobContext,
        total: int,
        clock: Clock,
        start_ms: int,
    ) -> None:
        self._inner = inner
        self._context = context
        self._total = total
        self._clock = clock
        self._start_ms = start_ms
        self.written = 0

    def write(self, frame: FrameBuffer) -> Result[None]:
        result = self._inner.write(frame)
        if result.is_err():
            return result
        self.written += 1
        elapsed_ms = self._clock.now_ms() - self._start_ms
        self._context.report(
            JobProgress(
                fraction=self.written / self._total,
                stage=ExportStage.ENCODING,
                eta_seconds=_eta(elapsed_ms, self.written, self._total),
                detail=f"frame {self.written} of {self._total}",
                payload={"frame": self.written, "frames": self._total},
            )
        )
        if self.written % EXPORT_CHECKPOINT_EVERY == 0:
            self._context.checkpoint({"frames_written": self.written})
        return result

    def finish(self) -> Result[RenderStats]:
        # No report here: what this finishes is the *stream*, and the container
        # is finished by the caller afterwards. Reporting "muxing" at the flush
        # would leave the bar at 100 % while the trailer was still being
        # written, which is the exact hang it is meant to distinguish.
        return self._inner.finish()

    def abort(self) -> None:
        self._inner.abort()


def _eta(elapsed_ms: int, done: int, total: int) -> float | None:
    """Seconds remaining, once there is a rate to extrapolate from.

    ``None`` for the first few frames: an estimate from one frame is a number
    that will be wrong by a factor of ten and will thrash the UI that shows it.
    """
    if done < 5 or done >= total:
        return None
    per_frame_ms = elapsed_ms / done
    return round((total - done) * per_frame_ms / 1000.0, 1)


@dataclass(frozen=True, slots=True)
class ExportVideoJob:
    """Render a range of a project into a file, as a job body.

    Call it with a :class:`~nova_studio.ports.jobs.JobContext` and it returns
    ``Ok(JobOutcome)`` with the artefacts, or ``Err`` with the code that says
    why not. Every collaborator is a factory that is called **inside** the run,
    so nothing unpicklable is captured and the worker can build its own
    decoders on its own side of the process boundary.

    Args:
        project: What is being exported. Frozen, so a worker's copy cannot be
            changed by an edit happening in the editor while it runs.
        request: Where it goes, and which frames.
        renderer_factory: How to open the output. Called once, in the worker.
        ops_factory: The pixel primitives the compositor resamples with.
        decoder_factory: How to open a media file.
        clock_factory: For elapsed time and ETA. Defaults to the system clock.
        resolve_factory: ``project -> (asset_id, source) -> path``. Defaults to
            the original for everything; the media layer supplies proxies.
        cache_bytes: How much decoded picture the pool may hold.

    **Cancellation** is polled, never fatal: the loop stops between frames, the
    target is aborted, and the job ends as ``Err(NS-JOB-5005)`` — which the UI
    renders as "stopped", not "failed", because the user asked for it.

    **Failure** leaves no file. The renderer writes beside the target and
    promotes on success, and an error or a cancellation aborts, so
    :attr:`~nova_studio.core.jobs.JobOutcome.artefacts` names only complete
    files (ADR-0010, port rule 7).
    """

    project: Project
    request: ExportRequest
    renderer_factory: RendererFactory
    ops_factory: OpsFactory
    decoder_factory: DecoderFactory
    clock_factory: ClockFactory | None = None
    resolve_factory: ResolveFactory | None = None
    cache_bytes: int = EXPORT_CACHE_BYTES

    def __call__(self, context: JobContext) -> Result[JobOutcome]:
        """Run the export. The whole job, in the order it has to happen."""
        clock = (self.clock_factory or SystemClock)()
        frames = self.request.frames_for(self.project)
        total = len(frames)
        started_ms = clock.now_ms()

        context.report(
            JobProgress(
                fraction=0.0,
                stage=ExportStage.PREPARING,
                detail=_destination(self.request.path),
                payload={"frames": total},
            )
        )

        opened = self.renderer_factory().open(self.request.spec, self.request.path)
        if opened.is_err():
            return err(opened.unwrap_err())
        target = opened.unwrap()

        resolve = (self.resolve_factory or _resolver_for)(self.project)
        with FrameSourcePool(
            self.decoder_factory(),
            resolve,
            capacity=EXPORT_OPEN_SOURCES,
            cache_bytes=self.cache_bytes,
        ) as pool:
            sink = _ProgressSink(
                target.video(),
                context=context,
                total=total,
                clock=clock,
                start_ms=started_ms,
            )
            outcome: RenderOutcome = render_frames(
                self.project,
                frames,
                pool=pool,
                ops=self.ops_factory(),
                sink=sink,
                cancel=context.is_cancelled,
            )

        if outcome.cancelled:
            # The loop stopped between frames and aborted the stream; aborting
            # the target is what removes the file it was writing to.
            target.abort()
            return err(_cancelled(sink.written, total))
        if outcome.error is not None:
            target.abort()
            return err(outcome.error)
        if self.request.fail_on_missing and outcome.missing:
            target.abort()
            return err(_offline(outcome.missing))

        # The container's commit point. `render_frames` finished the *stream*,
        # which flushed the encoder; this writes the index and the trailer and
        # promotes the temporary file, and a file is only valid after it.
        context.report(
            JobProgress(
                fraction=1.0,
                stage=ExportStage.MUXING,
                detail="writing the container",
            )
        )
        committed = target.finish()
        if committed.is_err():
            return err(committed.unwrap_err())
        stats = committed.unwrap()
        elapsed_ms = max(0, clock.now_ms() - started_ms)
        stats = RenderStats(
            frames_written=stats.frames_written,
            bytes_written=stats.bytes_written,
            elapsed_ms=stats.elapsed_ms or elapsed_ms,
        )

        context.report(
            JobProgress(
                fraction=1.0,
                stage=ExportStage.DONE,
                detail=export_summary(stats, missing=outcome.missing),
                payload={"missing": list(outcome.missing)},
            )
        )
        return ok(
            JobOutcome(
                value=stats,
                artefacts=(self.request.path,),
                detail=export_summary(stats, missing=outcome.missing),
            )
        )


def _destination(path: str) -> str:
    """The file name, not the whole path: a progress bar is three lines long."""
    return path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]


def _cancelled(written: int, total: int) -> NovaError:
    return NovaError(
        JobErrorCode.CANCELLED,
        f"export stopped after {written} of {total} frames",
        remedy="Start the export again when you are ready; nothing was written.",
        details={"frames_written": written, "frames_total": total},
    )


def _offline(missing: tuple[str, ...]) -> NovaError:
    return NovaError(
        RenderErrorCode.ENCODE_FAILED,
        f"{len(missing)} asset(s) are offline and this export requires every layer",
        remedy="Relink the missing media, or export with 'render missing layers as gaps'.",
        details={"missing": list(missing)},
    )
