"""L3 — the audio engine: what a stretch of the timeline sounds like.

``media-and-rendering.md`` §7.2 promises that **preview and export use the same
code path**, and audio is where that promise is easiest to break: it is tempting
to give the preview a cheap path (decode whole clips, hold them in memory, mix
the lot) and the export a different one (stream, block by block), and then spend
a year on bugs that only happen in one of them. So there is one mixer here, it
is block-based, and the preview asks it for a short range while the export asks
it for a long one.

Three decisions shape it, and each is the answer to a bug that is otherwise
certain:

**Blocks, not a buffer.** :func:`mix_audio` yields one block per
:data:`DEFAULT_BLOCK_FRAMES` timeline frames. A two-hour export at 48 kHz stereo
is two gigabytes of float32 — a mixer that built one array would be a mixer that
could not export a film. The block is also the natural unit of cancellation and
of progress reporting, which is what the export job wants anyway.

**Every sample is anchored to the plan, never to the previous block.** A
segment's offset is computed from its frame position with
:func:`~nova_studio.core.temporal.frames_to_samples`, which is exact rational
arithmetic. Accumulating a running "next sample" instead would drift by up to
half a sample per segment, and drift in audio is not a rounding error — it is
lip sync, and it gets worse the longer the programme is.

**A seek per block, deliberately.** Each block asks each clip for exactly the
samples it covers. That is one seek per clip per second of programme, which
sounds expensive until you notice what the alternative is: holding a whole
clip's audio in memory to avoid it. Audio seeks are cheap — unlike a video seek
there is no GOP to walk — so this is the trade that buys bounded memory for
work the decoder was going to do anyway.

What is **not** here: which file to decode (the media layer decides), how samples
are resampled (:class:`~nova_studio.ports.media.AudioResampler`), and where the
result goes (a sink, chosen by the caller). Every collaborator is injected, so
this module is testable with a synth and without FFmpeg.

The one thing that *is* here and could have been a port is the soft clip
(:func:`_soft_clip`), because it is four lines of NumPy and a port for it would
be a port with exactly one implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import TYPE_CHECKING, Final, TypeAlias

import numpy as np

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Timebase, frames_to_samples
from nova_studio.domain.audio import FadeShape
from nova_studio.domain.media import AudioBuffer
from nova_studio.services.render.frames import DECODE_FROM_ORIGINAL

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping

    from nova_studio.core.errors import NovaError
    from nova_studio.domain.media import MediaInfo
    from nova_studio.domain.project import Project
    from nova_studio.ports.media import AudioResampler, AudioSampleSource

__all__ = [
    "DEFAULT_BLOCK_FRAMES",
    "AudioMixStats",
    "AudioPlan",
    "AudioSegment",
    "MediaInfoProvider",
    "MixBlock",
    "SourceProvider",
    "mix_all",
    "mix_audio",
    "plan_audio",
]

#: How many timeline frames one mixed block covers. A second at 30 fps is
#: ~384 KiB of stereo float32 — small enough that twenty of them are nothing,
#: large enough that a seek per block is not the dominant cost.
DEFAULT_BLOCK_FRAMES: Final[int] = 30

#: ``(asset_id, source) -> an open sample source``, or ``None`` when that copy
#: of the file is not there. Supplied by the caller, because which file *is* the
#: proxy is a media question and this feature may not ask it (ADR-0002 rule 4).
SourceProvider: TypeAlias = "Callable[[str, str], AudioSampleSource | None]"

#: ``(asset_id, source) -> the probe summary``, or ``None`` for a file that is
#: not available. The plan does not need it — it reads probes from the project
#: — but the mixer does, because only a live file knows for certain how fast its
#: samples run.
MediaInfoProvider: TypeAlias = "Callable[[str, str], MediaInfo | None]"

#: Above this amplitude the soft clip starts bending. -3 dB: a mix that never
#: gets there comes out bit-identical to one that was never limited.
_CLIP_KNEE: Final[float] = 0.7071067811865476

#: The floor :attr:`FadeShape.EXPONENTIAL` approaches, as a linear amplitude.
_FLOOR_LINEAR: Final[float] = 0.001


@dataclass(frozen=True, slots=True, kw_only=True)
class AudioSegment:
    """One clip's contribution to one stretch of the timeline.

    A segment is a **contiguous run of one clip**, not a clip: a clip that runs
    the whole length of a two-hour export is still one segment here, and a clip
    that appears three times is three. It is the unit of work, and it is
    described entirely in frames, because frames are the only unit the timeline
    and the document agree on.

    The source window is stored **ascending even when the clip plays backwards**,
    with :attr:`reversed` saying which way to read it. A decoder is asked for a
    range, not for a direction, and carrying a direction inside a frame number
    is how a reverse clip gets read from the wrong end.
    """

    clip_id: str
    asset_id: str
    track_id: str
    #: Which copy to read: ``"original"``, ``"proxy"`` or ``"thumbnail"``.
    source: str = DECODE_FROM_ORIGINAL
    #: First timeline frame this segment covers, inclusive.
    start_frame: int = 0
    #: Last timeline frame this segment covers, exclusive.
    end_frame: int = 0
    #: Where the clip itself begins and ends, which is what a fade is measured
    #: from: a segment is often only the middle of a clip, and a fade belongs to
    #: the clip, not to the slice of it this block happens to cover.
    clip_start_frame: int = 0
    clip_end_frame: int = 0
    #: First source frame read, inclusive.
    source_start_frame: int = 0
    #: Last source frame read, exclusive.
    source_end_frame: int = 0
    #: Whether the source window is read backwards.
    reversed: bool = False
    #: Linear gain. ``1.0`` is unity.
    gain: float = 1.0
    #: Stereo position, -1 to +1. A no-op on more than two channels.
    pan: float = 0.0
    fade_in_frames: int = 0
    fade_out_frames: int = 0
    fade_shape: FadeShape = FadeShape.EQUAL_POWER

    @property
    def duration_frames(self) -> int:
        """How many timeline frames this segment covers."""
        return max(0, self.end_frame - self.start_frame)

    @property
    def source_frames(self) -> int:
        """How many source frames are read for it."""
        return max(0, self.source_end_frame - self.source_start_frame)

    @property
    def is_silent(self) -> bool:
        """Whether it can make no sound at all."""
        return self.duration_frames == 0 or self.source_frames == 0 or self.gain == 0.0


@dataclass(frozen=True, slots=True, kw_only=True)
class AudioPlan:
    """Everything one stretch of the timeline needs in order to be heard.

    Pure: a function of a project and a range, with no decoder anywhere in it,
    which is why it can be built in a test, compared field by field, and cached
    across the blocks of one render — the blocks change, the plan does not.
    """

    start_frame: int
    end_frame: int
    sample_rate: int
    channels: int
    #: The project's frame rate. Carried because a sample position is a frame
    #: position converted, and the conversion needs the rate it was taken at.
    timebase: Timebase
    segments: tuple[AudioSegment, ...] = ()

    @property
    def duration_frames(self) -> int:
        """How long this plan is, in frames."""
        return max(0, self.end_frame - self.start_frame)

    @property
    def sample_count(self) -> int:
        """How many samples the whole plan mixes to.

        Computed from the range and not from the segments' parts, so two
        adjacent blocks cannot disagree about where the boundary between them
        is.
        """
        return _samples(self.end_frame, self.timebase, self.sample_rate) - _samples(
            self.start_frame, self.timebase, self.sample_rate
        )

    @property
    def is_empty(self) -> bool:
        """Whether anything at all will be heard."""
        return not self.segments or self.duration_frames == 0

    @property
    def audible_segments(self) -> tuple[AudioSegment, ...]:
        """The segments that can make a sound."""
        return tuple(segment for segment in self.segments if not segment.is_silent)

    def segments_for(self, start_frame: int, end_frame: int) -> tuple[AudioSegment, ...]:
        """The segments that overlap one range, clipped to it.

        The clip is the whole point: a block asks for one second of a clip that
        runs for ten minutes and gets a segment covering one second of it —
        source window and all — rather than a segment describing the whole clip
        and a mixer that has to work out which part it wanted.
        """
        return tuple(
            _narrow(segment, start_frame, end_frame)
            for segment in self.audible_segments
            if segment.end_frame > start_frame and segment.start_frame < end_frame
        )


@dataclass(frozen=True, slots=True)
class AudioMixStats:
    """What a mix did. Counts, because that is what a report wants."""

    blocks: int = 0
    samples: int = 0
    segments: int = 0
    #: Segments skipped because the file was not there.
    missing: int = 0
    #: Segments skipped because the file has no audio stream, which is a fact
    #: about the file and not a problem to report.
    silent_sources: int = 0
    #: Samples the soft clip had to bend.
    clipped: int = 0
    #: Peak absolute amplitude seen, before the soft clip. ``0.0`` for silence.
    peak: float = 0.0

    def __add__(self, other: AudioMixStats) -> AudioMixStats:
        return AudioMixStats(
            blocks=self.blocks + other.blocks,
            samples=self.samples + other.samples,
            segments=self.segments + other.segments,
            missing=self.missing + other.missing,
            silent_sources=self.silent_sources + other.silent_sources,
            clipped=self.clipped + other.clipped,
            peak=max(self.peak, other.peak),
        )


@dataclass(frozen=True, slots=True)
class MixBlock:
    """One mixed block: the samples, where they belong, and what happened."""

    start_frame: int
    end_frame: int
    buffer: AudioBuffer
    stats: AudioMixStats = field(default_factory=AudioMixStats)
    #: Asset ids that were not available. Kept per block so a caller can say
    #: "this render is missing two files" without collecting a set for an hour.
    missing: tuple[str, ...] = ()
    #: The failure that stopped a read, if one did. A damaged file is reported
    #: once, at the block that found it, rather than once per second of
    #: programme.
    error: NovaError | None = None

    @property
    def duration_frames(self) -> int:
        """How many timeline frames this block covers."""
        return max(0, self.end_frame - self.start_frame)


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def plan_audio(
    project: Project,
    start_frame: int,
    end_frame: int,
    *,
    sources: Mapping[str, str] | None = None,
    default_source: str = DECODE_FROM_ORIGINAL,
) -> AudioPlan:
    """Build the recipe for one stretch of a project's soundtrack.

    Args:
        project: What is being rendered.
        start_frame: First timeline frame, inclusive.
        end_frame: Last timeline frame, exclusive. Clamped to the project,
            because asking past the end of the edit is how a render asks for
            "the rest".
        sources: Which copy of each asset to decode, keyed by asset id. Decided
            by the media layer and passed in; a missing entry falls back to
            ``default_source``.
        default_source: What to use for an asset with no entry.

    Returns:
        A plan. It never fails for a *range* — an empty stretch of timeline is a
        plan with no segments — but it raises :class:`NovaInvariantError` for a
        negative frame or a range that runs backwards, which is a bug in the
        caller and not a state a project can be in.

    What it decides, and the two rules behind it:

    * **A muted track is silent; a hidden one is not.** Muting is about sound, so
      it happens here. Hiding is about the picture, so it does not: a hidden
      track's clips are still heard, which is what "hidden" means in every
      editor and the reason the two are separate flags.
    * **A file with no audio stream is dropped here, not at decode time.** The
      probe summary in the project already knows, and asking a decoder for a
      stream a file does not have would turn a fact about the file into a
      per-block failure. A clip whose asset has never been probed is *kept*:
      an unprobed asset is one we know nothing about, and silence would be a
      guess.
    """
    if start_frame < 0 or end_frame < 0:
        raise NovaInvariantError(f"frames must not be negative, got [{start_frame}, {end_frame})")
    if end_frame < start_frame:
        raise NovaInvariantError(
            f"end_frame ({end_frame}) must not precede start_frame ({start_frame})"
        )
    timeline = project.timeline
    last = max(timeline.duration_frames, 0)
    start = min(start_frame, last)
    stop = min(end_frame, last)
    chosen = sources or {}
    segments: list[AudioSegment] = []

    for track in timeline.tracks:
        if track.muted:
            continue
        for clip in track.clips:
            if not clip.enabled or clip.is_generated:
                continue
            if clip.end_frame <= start or clip.start_frame >= stop:
                continue
            asset = project.asset(clip.asset_id)
            if asset is not None and asset.probe is not None and not asset.probe.has_audio:
                continue
            audio = project.audio_for(clip.clip_id)
            window_start = max(clip.start_frame, start)
            window_stop = min(clip.end_frame, stop)
            forward = clip.speed >= 0
            # The span, not the endpoints: at 2x one timeline frame eats two
            # source frames, so a window measured between the source frames its
            # *ends* happen to show would be one short every time. Speed is a
            # rational, so this is exact.
            span = round(Fraction(window_stop - window_start) * abs(Fraction(clip.speed)))
            anchor = clip.source_frame_at(window_start)
            # Stored ascending whichever way it is played: a decoder is asked
            # for a range, and a reverse clip is a range read backwards.
            low, high = (anchor, anchor + span) if forward else (anchor + 1 - span, anchor + 1)
            floor = min(clip.in_frame, max(clip.out_frame - 1, 0))
            low = min(max(low, floor), clip.out_frame)
            high = min(max(high, low), clip.out_frame)
            segments.append(
                AudioSegment(
                    clip_id=clip.clip_id,
                    asset_id=clip.asset_id,
                    track_id=track.track_id,
                    source=chosen.get(clip.asset_id, default_source),
                    start_frame=window_start,
                    end_frame=window_stop,
                    clip_start_frame=clip.start_frame,
                    clip_end_frame=clip.end_frame,
                    source_start_frame=low,
                    source_end_frame=high,
                    reversed=not forward,
                    gain=audio.gain,
                    pan=audio.pan,
                    fade_in_frames=audio.fade_in_frames,
                    fade_out_frames=audio.fade_out_frames,
                    fade_shape=audio.fade_shape,
                )
            )

    return AudioPlan(
        start_frame=start,
        end_frame=stop,
        sample_rate=project.settings.sample_rate,
        channels=project.settings.channels,
        timebase=timeline.timebase,
        segments=tuple(segments),
    )


def _narrow(segment: AudioSegment, start_frame: int, end_frame: int) -> AudioSegment:
    """Trim one segment to a range that overlaps it.

    The source window moves with it: the fraction of the segment being kept is
    the fraction of the source window kept, because speed is constant across a
    segment by construction — a ramped speed is a future slice, and it will
    produce several segments with one constant speed each.
    """
    start = max(segment.start_frame, start_frame)
    stop = min(segment.end_frame, end_frame)
    span = segment.duration_frames
    if span <= 0:
        return segment
    source_span = segment.source_frames
    dropped_head = round((start - segment.start_frame) * source_span / span)
    dropped_tail = round((segment.end_frame - stop) * source_span / span)
    if segment.reversed:
        # The window is ascending on disc and read backwards, so a cut at the
        # *start* of the timeline takes from the *end* of the window.
        low = segment.source_start_frame + dropped_tail
        high = segment.source_end_frame - dropped_head
    else:
        low = segment.source_start_frame + dropped_head
        high = segment.source_end_frame - dropped_tail
    return _with_window(segment, start, stop, min(low, high), max(low, high))


def _with_window(segment: AudioSegment, start: int, stop: int, low: int, high: int) -> AudioSegment:
    return AudioSegment(
        clip_id=segment.clip_id,
        asset_id=segment.asset_id,
        track_id=segment.track_id,
        source=segment.source,
        start_frame=start,
        end_frame=stop,
        clip_start_frame=segment.clip_start_frame,
        clip_end_frame=segment.clip_end_frame,
        source_start_frame=low,
        source_end_frame=high,
        reversed=segment.reversed,
        gain=segment.gain,
        pan=segment.pan,
        fade_in_frames=segment.fade_in_frames,
        fade_out_frames=segment.fade_out_frames,
        fade_shape=segment.fade_shape,
    )


# ---------------------------------------------------------------------------
# Mixing
# ---------------------------------------------------------------------------


def mix_audio(
    plan: AudioPlan,
    *,
    sources: SourceProvider,
    resampler: AudioResampler,
    info: MediaInfoProvider,
    block_frames: int = DEFAULT_BLOCK_FRAMES,
    cancel: Callable[[], bool] | None = None,
) -> Iterator[MixBlock]:
    """Mix a plan, one block at a time.

    Args:
        plan: What to mix, from :func:`plan_audio`.
        sources: How to open an asset's samples.
        resampler: How to convert samples between rates and channel counts.
        info: The probe summary of the file actually being read.
        block_frames: How many timeline frames one block covers.
        cancel: Asked once per block. A block is atomic: cancelling stops
            *between* blocks and never part way through one, because a
            half-mixed block is a click the user did not ask for.

    Yields:
        One :class:`MixBlock` per ``block_frames``, in timeline order, plus a
        final short one. An empty plan yields nothing at all, which is how a
        caller tells "this stretch is silent" from "this stretch produced a
        block of silence".

    A missing file, a file with no audio and a decode failure are all reported
    rather than raised: a render that stopped because one clip's audio was
    unreadable would throw away an hour of pictures to protect thirty seconds
    of sound. Whether any of those is fatal is the caller's decision — the
    export job has a ``fail_on_missing`` for exactly that.
    """
    if block_frames < 1:
        raise NovaInvariantError(f"block_frames must be at least 1, got {block_frames}")
    if plan.is_empty:
        return
    frame = plan.start_frame
    while frame < plan.end_frame:
        if cancel is not None and cancel():
            return
        stop = min(frame + block_frames, plan.end_frame)
        yield _mix_block(plan, frame, stop, sources=sources, resampler=resampler, info=info)
        frame = stop


def mix_all(
    plan: AudioPlan,
    *,
    sources: SourceProvider,
    resampler: AudioResampler,
    info: MediaInfoProvider,
    block_frames: int = DEFAULT_BLOCK_FRAMES,
) -> tuple[AudioBuffer, AudioMixStats, tuple[str, ...]]:
    """Mix a whole plan into one buffer. For previews, and for tests.

    The export job must **not** use this: a two-hour programme does not fit in
    memory, which is the whole reason :func:`mix_audio` is a generator. The
    limit is not enforced here because a preview asking for three seconds and an
    export asking for three hours are the same call, and refusing the second one
    is the caller's job, not the mixer's.
    """
    pieces: list[np.ndarray] = []
    stats = AudioMixStats()
    missing: list[str] = []
    for block in mix_audio(
        plan, sources=sources, resampler=resampler, info=info, block_frames=block_frames
    ):
        if block.buffer.frame_count:
            pieces.append(block.buffer.samples)
        stats = stats + block.stats
        missing.extend(name for name in block.missing if name not in missing)
    if not pieces:
        empty = np.zeros((0, plan.channels), dtype=np.float32)
        return AudioBuffer(samples=empty, sample_rate=plan.sample_rate), stats, tuple(missing)
    return (
        AudioBuffer(samples=np.concatenate(pieces, axis=0), sample_rate=plan.sample_rate),
        stats,
        tuple(missing),
    )


def _mix_block(
    plan: AudioPlan,
    start_frame: int,
    end_frame: int,
    *,
    sources: SourceProvider,
    resampler: AudioResampler,
    info: MediaInfoProvider,
) -> MixBlock:
    """Mix one block. The whole engine, for one second of programme."""
    total = _samples(end_frame, plan.timebase, plan.sample_rate) - _samples(
        start_frame, plan.timebase, plan.sample_rate
    )
    mixed = np.zeros((max(total, 0), plan.channels), dtype=np.float32)
    stats = AudioMixStats(blocks=1)
    missing: list[str] = []
    error: NovaError | None = None

    for segment in plan.segments_for(start_frame, end_frame):
        if sources(segment.asset_id, segment.source) is None:
            if segment.asset_id not in missing:
                missing.append(segment.asset_id)
            stats = stats + AudioMixStats(missing=1)
            continue
        probe = info(segment.asset_id, segment.source)
        audio_info = probe.primary_audio() if probe is not None else None
        if audio_info is None:
            stats = stats + AudioMixStats(silent_sources=1)
            continue
        handle = sources(segment.asset_id, segment.source)
        assert handle is not None  # checked above; the second call is the same
        rendered = _render_segment(
            segment,
            plan,
            start_frame,
            end_frame,
            handle=handle,
            resampler=resampler,
            audio_rate=audio_info.sample_rate,
            video_timebase=(_video_timebase(probe) if probe is not None else None),
        )
        if rendered.error is not None and error is None:
            error = rendered.error
        if rendered.samples is None:
            continue
        offset = _samples(
            max(segment.start_frame, start_frame), plan.timebase, plan.sample_rate
        ) - _samples(start_frame, plan.timebase, plan.sample_rate)
        end = min(offset + rendered.samples.shape[0], mixed.shape[0])
        if end > offset:
            mixed[offset:end] += rendered.samples[: end - offset]
            stats = stats + AudioMixStats(segments=1)

    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    clipped = int(np.count_nonzero(np.abs(mixed) > _CLIP_KNEE))
    if clipped:
        np.clip(_soft_clip(mixed), -1.0, 1.0, out=mixed)
    return MixBlock(
        start_frame=start_frame,
        end_frame=end_frame,
        buffer=AudioBuffer(samples=mixed, sample_rate=plan.sample_rate),
        stats=stats + AudioMixStats(samples=int(mixed.shape[0]), peak=peak, clipped=clipped),
        missing=tuple(missing),
        error=error,
    )


@dataclass(frozen=True, slots=True)
class _Rendered:
    """One segment's samples for one block, or the reason there are none."""

    samples: np.ndarray | None = None
    error: NovaError | None = None


def _render_segment(
    segment: AudioSegment,
    plan: AudioPlan,
    block_start: int,
    block_end: int,
    *,
    handle: AudioSampleSource,
    resampler: AudioResampler,
    audio_rate: int,
    video_timebase: Timebase | None,
) -> _Rendered:
    """Decode one segment's slice, retime it, and dress it.

    The steps, in the order they have to happen:

    1. **Map the source window to samples**, using the asset's own frame rate
       when it has one. An audio-only file has none, so the project's is used —
       the convention a still image already follows, because a clip's in and out
       points are timeline coordinates whatever the source is.
    2. **Decode.** One contiguous read, which is the only kind a decoder is fast
       at.
    3. **Reverse** if the clip plays backwards — *before* the resample, so a
       reversed clip is resampled forwards. Reversing after a filter would smear
       its impulse response backwards through time.
    4. **Resample to the exact target length.** Speed, and the asset's rate
       against the project's, both fall out of one ratio: ``M`` source samples
       have to become ``N``, so the resampler is asked for the rate that does
       that. libswresample is not sample-exact, so the result is trimmed or
       padded to ``N`` — a difference of a few samples, which is tens of
       microseconds, and it is corrected *per block* so it cannot accumulate.
    5. **Fade, gain and pan**, in that order: a fade is the clip's shape, gain is
       the user's level, and pan is where it goes.
    """
    window_start = max(segment.start_frame, block_start)
    window_stop = min(segment.end_frame, block_end)
    if window_stop <= window_start:
        return _Rendered()
    rate = video_timebase if video_timebase is not None else plan.timebase
    source_start = frames_to_samples(segment.source_start_frame, rate, audio_rate)
    source_end = frames_to_samples(segment.source_end_frame, rate, audio_rate)
    wanted = max(source_end - source_start, 0)
    target = _samples(window_stop, plan.timebase, plan.sample_rate) - _samples(
        window_start, plan.timebase, plan.sample_rate
    )
    if wanted == 0 or target <= 0:
        return _Rendered()

    decoded = _read(handle, source_start, wanted)
    if decoded is None:
        return _Rendered(error=handle.last_error())
    if decoded.shape[0] == 0:
        return _Rendered()
    if segment.reversed:
        decoded = np.ascontiguousarray(decoded[::-1])

    stretched = _retime(decoded, target, resampler, plan, audio_rate)
    _dress(stretched, segment, window_start, plan.timebase, plan.sample_rate)
    return _Rendered(samples=stretched)


def _read(handle: AudioSampleSource, start: int, count: int) -> np.ndarray | None:
    """Read ``count`` samples from ``start``, or ``None`` if the read failed."""
    blocks: list[np.ndarray] = []
    taken = 0
    for block in handle.samples(start=start, count=count):
        if block.frame_count == 0:
            continue
        blocks.append(block.samples)
        taken += block.frame_count
        if taken >= count:
            break
    if not blocks:
        return None
    joined = np.concatenate(blocks, axis=0) if len(blocks) > 1 else blocks[0]
    return joined[:count] if joined.shape[0] > count else joined


def _retime(
    decoded: np.ndarray,
    target: int,
    resampler: AudioResampler,
    plan: AudioPlan,
    audio_rate: int,
) -> np.ndarray:
    """Make ``decoded`` exactly ``target`` samples long, at the plan's rate.

    The resampler is asked for the *rate* that lands on the target rather than
    for the target itself, because a rate is what a resampler converts between.
    ``target`` is the number that matters, so the result is trimmed or
    zero-padded to it — see step 4 of :func:`_render_segment`.
    """
    have = int(decoded.shape[0])
    if have == 0:
        return np.zeros((0, plan.channels), dtype=np.float32)
    if have == target and audio_rate == plan.sample_rate and decoded.shape[1] == plan.channels:
        return np.ascontiguousarray(decoded, dtype=np.float32)
    wanted_rate = max(1, round(audio_rate * target / have))
    converted = resampler.resample(
        AudioBuffer(samples=decoded, sample_rate=audio_rate),
        sample_rate=wanted_rate,
        channels=plan.channels,
    )
    fitted = np.ascontiguousarray(converted.samples, dtype=np.float32)
    if fitted.shape[0] == target:
        return fitted
    if fitted.shape[0] > target:
        return fitted[:target]
    padded = np.zeros((target, plan.channels), dtype=np.float32)
    width = min(fitted.shape[1], plan.channels)
    padded[: fitted.shape[0], :width] = fitted[:, :width]
    return padded


def _dress(
    samples: np.ndarray,
    segment: AudioSegment,
    window_start: int,
    timebase: Timebase,
    sample_rate: int,
) -> None:
    """Apply the fade, the gain and the pan, in that order, in place."""
    count = int(samples.shape[0])
    if count == 0:
        return
    envelope = _envelope(segment, window_start, count, timebase, sample_rate)
    if envelope is not None:
        samples *= envelope[:, None]
    if segment.gain != 1.0:
        samples *= np.float32(segment.gain)
    if segment.pan != 0.0 and samples.shape[1] == 2:
        left, right = _pan_gains(segment.pan)
        samples[:, 0] *= np.float32(left)
        samples[:, 1] *= np.float32(right)


def _envelope(
    segment: AudioSegment,
    window_start: int,
    count: int,
    timebase: Timebase,
    sample_rate: int,
) -> np.ndarray | None:
    """The fade curve over one block, or ``None`` when nothing fades.

    A fade belongs to the *clip*, so it is measured from the clip's own ends
    even when this block covers only the middle of it — which is why a segment
    carries both its own window and its clip's. Built as one array and applied
    as one multiply, because a per-sample call into Python is a second of CPU
    per second of programme.
    """
    if not segment.fade_in_frames and not segment.fade_out_frames:
        return None
    first = _samples(window_start, timebase, sample_rate)
    ramp = np.ones(count, dtype=np.float32)
    positions = np.arange(count, dtype=np.float64) + first
    if segment.fade_in_frames:
        begin = _samples(segment.clip_start_frame, timebase, sample_rate)
        span = _samples(segment.clip_start_frame + segment.fade_in_frames, timebase, sample_rate)
        ramp *= _curve(
            segment.fade_shape,
            np.clip((positions - begin) / max(span - begin, 1), 0.0, 1.0),
            rising=True,
        )
    if segment.fade_out_frames:
        begin = _samples(segment.clip_end_frame - segment.fade_out_frames, timebase, sample_rate)
        span = _samples(segment.clip_end_frame, timebase, sample_rate)
        ramp *= _curve(
            segment.fade_shape,
            np.clip((positions - begin) / max(span - begin, 1), 0.0, 1.0),
            rising=False,
        )
    return ramp


def _curve(shape: FadeShape, t: np.ndarray, *, rising: bool) -> np.ndarray:
    """The vectorised form of :func:`~nova_studio.domain.audio.fade_factor`.

    Both exist because the domain's version is the definition — readable, exact
    at both ends, and testable without NumPy — while this one is what a million
    samples need. A test pins that the two agree, which is the only thing that
    keeps them from drifting apart.
    """
    position = t if rising else 1.0 - t
    if shape is FadeShape.LINEAR:
        return position.astype(np.float32)
    if shape is FadeShape.EQUAL_POWER:
        return np.sin(position * (np.pi / 2.0)).astype(np.float32)
    if shape is FadeShape.S_CURVE:
        return (position * position * (3.0 - 2.0 * position)).astype(np.float32)
    floor = np.float32(_FLOOR_LINEAR)
    return ((np.power(floor, 1.0 - position) - floor) / (1.0 - floor)).astype(np.float32)


def _pan_gains(pan: float) -> tuple[float, float]:
    """Equal-power stereo gains for a pan position.

    ``cos``/``sin`` rather than a straight cross-fade: a linear pan dips by
    6 dB in the middle, so a clip panned to centre would be quieter than the
    same clip not panned at all, and a user would reach for the gain to fix a
    problem the pan caused.
    """
    angle = (pan + 1.0) * (np.pi / 4.0)
    return float(np.cos(angle)), float(np.sin(angle))


def _soft_clip(samples: np.ndarray) -> np.ndarray:
    """Bend everything above the knee towards the ceiling, smoothly.

    This is a **safety net, not a limiter**. Its job is narrow and absolute: a
    file Nova Studio writes never contains digital clipping, because digital
    clipping is the one audio failure a listener can hear from another room.
    Everything below :data:`_CLIP_KNEE` comes out bit-identical, so a mix that
    never gets loud is not touched at all.

    It has no lookahead and no release, so it is not the limiter §7.4 describes
    — that is a stateful dynamics processor and it belongs in a channel strip
    with the EQ and the compressor. What this guarantees is the part that must
    never be optional.
    """
    magnitude = np.abs(samples)
    bent = np.where(
        magnitude > _CLIP_KNEE,
        np.sign(samples)
        * (
            _CLIP_KNEE + (1.0 - _CLIP_KNEE) * np.tanh((magnitude - _CLIP_KNEE) / (1.0 - _CLIP_KNEE))
        ),
        samples,
    )
    return bent.astype(np.float32)


def _video_timebase(probe: MediaInfo) -> Timebase | None:
    """The frame rate to convert a source frame with, or ``None`` when the file
    has no picture to have one.

    An audio-only file has no frame rate of its own, so ``None`` is returned and
    the caller falls back to the project's — the rule a still image already
    follows, because a clip's in and out points are timeline coordinates
    whatever the source happens to be.
    """
    video = probe.primary_video()
    return video.timebase if video is not None else None


def _samples(frame: int, timebase: Timebase, sample_rate: int) -> int:
    """Where a timeline frame falls in the mix, in samples.

    Always computed from the frame and never accumulated, so the boundary
    between two blocks is the same number whichever side it is worked out from
    (§ module note).
    """
    return frames_to_samples(frame, timebase, sample_rate)
