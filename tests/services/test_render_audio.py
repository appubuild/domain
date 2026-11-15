"""The audio engine (`services/render/audio.py`).

A picture can be judged by looking at it. Sound cannot be checked in a test by
listening, so everything here is checked the other way: with a source whose
every sample is a known number, and assertions about *which numbers came out
and where*. A sample that arrives one place along from where it belongs is, to
a listener, silence for a moment and then a click; a sample that is a
hundredth of a decibel wrong is nothing at all.

So the source here is a synthesiser, not a file: sample ``n`` of the stream is
``0.5 + n · 10⁻⁶`` — a slow ramp whose value *is* its position, which makes an
assertion about placement an assertion about arithmetic rather than about ears.
It also stays near 0.5, so nothing in these tests is accidentally quiet enough
to be zero or loud enough to hit the safety net.

What is being pinned, and what a rewrite would quietly break:

* **Placement.** A clip starting at frame 30 contributes nothing before frame
  30 and everything from it, to the sample.
* **Retiming.** A 2× clip reads twice the source for the same stretch of
  timeline; a reversed one plays backwards. Both are still the same length in
  the timeline — the length of the *edit*, which is the one length that must
  not change when a speed does.
* **Blocks do not drift.** A range mixed in thirty blocks is the same array as
  one mixed in a single block. This is lip sync, and it is the bug no
  ten-second test would ever show.
* **A fade belongs to the clip**, not to the block that happens to cover it.
* **The vectorised fade curve is the domain's curve** — the only thing keeping
  two implementations of one definition from drifting apart.
* **A missing file is reported, not fatal.** An hour of pictures is not thrown
  away to protect thirty seconds of sound.
* **Nothing the mixer writes can contain digital clipping.**
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from nova_studio.core.errors import NovaError
from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase
from nova_studio.domain.audio import ClipAudio, FadeShape, db_to_linear, fade_factor, linear_to_db
from nova_studio.domain.media import (
    AssetKind,
    AudioBuffer,
    AudioStreamInfo,
    MediaAsset,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.services.render.audio import mix_all, mix_audio, plan_audio

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)
RATE = 48_000
CHANNELS = 2

#: Samples per timeline frame at 30 fps and 48 kHz. A whole number, which is
#: why these tests can compare arrays exactly — a rate that does not divide the
#: sample rate is what :func:`_tone`'s slow ramp is for, and nothing here
#: depends on the arithmetic coming out even.
SAMPLES_PER_FRAME = RATE // 30


def _tone(position: np.ndarray) -> np.ndarray:
    """Sample ``n`` of the source: monotonic, its own position, and quiet.

    Quiet on purpose. A gain of +6 dB has to stay below the soft clip's knee
    for the gain tests to be about gain, and a value near 1.0 would make every
    assertion here a test of the safety net instead.
    """
    return 0.2 + position * 1e-6


# ---------------------------------------------------------------------------
# Doubles
# ---------------------------------------------------------------------------


class ToneSource:
    """A sample source with no file behind it.

    Blocks of 1024, because that is what a real decoder produces and a caller
    that assumed one block would be assuming a lie.
    """

    def __init__(self, *, rate: int = RATE, channels: int = CHANNELS, total: int = RATE * 10):
        self._rate = rate
        self._channels = channels
        self._total = total
        self.reads: list[tuple[int, int]] = []
        self.error: NovaError | None = None

    def info(self) -> AudioStreamInfo:
        return AudioStreamInfo(codec_name="pcm", sample_rate=self._rate, channels=self._channels)

    def sample_count(self) -> int:
        return self._total

    def samples(self, start: int = 0, count: int | None = None):  # type: ignore[no-untyped-def]
        self.reads.append((start, count if count is not None else -1))
        if count == 0:
            return
        wanted = self._total - start if count is None else min(count, self._total - start)
        done = 0
        while done < wanted:
            size = min(1024, wanted - done)
            positions = np.arange(start + done, start + done + size, dtype=np.float32)
            block = np.repeat(_tone(positions).reshape(-1, 1), self._channels, axis=1)
            yield AudioBuffer(samples=block.astype(np.float32), sample_rate=self._rate)
            done += size

    def last_error(self) -> NovaError | None:
        return self.error

    def close(self) -> None:
        return None


class SilentSource(ToneSource):
    """A source that yields nothing and names a reason, as a damaged file does."""

    def __init__(self) -> None:
        super().__init__()
        self.error = NovaError("NS-MEDIA-4001", "the file is damaged")

    def samples(self, start: int = 0, count: int | None = None):  # type: ignore[no-untyped-def]
        self.reads.append((start, count if count is not None else -1))
        return
        yield  # pragma: no cover


class CountingResampler:
    """A resampler that is honest about the contract and not about the sound.

    It converts by counting: ``n`` samples at rate ``r`` become
    ``round(n · target / r)``, which is what a real resampler does to within its
    filter's delay. Accuracy is the adapter's business; what the mixer needs is
    the *length* and the channel count, and those are exact here.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []

    def resample(self, buffer: AudioBuffer, *, sample_rate: int, channels: int) -> AudioBuffer:
        self.calls.append((sample_rate, channels))
        if buffer.frame_count == 0:
            return AudioBuffer(
                samples=np.zeros((0, channels), dtype=np.float32), sample_rate=sample_rate
            )
        target = max(1, round(buffer.frame_count * sample_rate / buffer.sample_rate))
        positions = np.linspace(0, buffer.frame_count - 1, target, dtype=np.float32)
        resampled = np.interp(
            positions, np.arange(buffer.frame_count, dtype=np.float32), buffer.samples[:, 0]
        )
        return AudioBuffer(
            samples=np.repeat(resampled.reshape(-1, 1), channels, axis=1).astype(np.float32),
            sample_rate=sample_rate,
        )


# ---------------------------------------------------------------------------
# Building projects and mixes
# ---------------------------------------------------------------------------


def _clip(
    clip_id: str, *, start: int = 0, source: int = 60, asset_id: str = "a1", **over: Any
) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=source, **over)


def _track(track_id: str, *clips: Clip, **over: Any) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)


def _probe(*, with_audio: bool = True, with_video: bool = True) -> MediaInfo:
    return MediaInfo(
        kind=AssetKind.VIDEO,
        duration_seconds=10.0,
        video=(VideoStreamInfo(codec_name="h264", width=1920, height=1080, timebase=TB),)
        if with_video
        else (),
        audio=(
            AudioStreamInfo(
                codec_name="aac", sample_rate=RATE, channels=CHANNELS, sample_count=RATE * 10
            ),
        )
        if with_audio
        else (),
    )


def _project(*tracks: Track, **over: Any) -> Project:
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(
            frame_size=FrameSize(width=1920, height=1080), sample_rate=RATE, channels=CHANNELS
        ),
        timeline=Timeline.of(*tracks, timebase=TB),
        **over,
    )


def _dressed(audio: ClipAudio, *, source: int = 60, start: int = 0) -> Project:
    """One clip, with `audio` attached to it."""
    return _project(_track("v1", _clip("c1", start=start, source=source))).with_audio("c1", audio)


def _mix(project: Project, start: int = 0, end: int | None = None, **over: Any) -> Any:
    """Plan and mix a range of a project, and hand back everything about it."""
    plan = plan_audio(project, start, end if end is not None else project.duration_frames)
    sources: dict[str, Any] = over.pop("sources", {"a1": ToneSource()})
    resampler = over.pop("resampler", CountingResampler())
    info = over.pop("info", lambda asset_id, source: _probe())
    buffer, stats, missing = mix_all(
        plan,
        sources=lambda asset_id, source: sources.get(asset_id),
        resampler=resampler,
        info=info,
        **over,
    )
    return buffer, stats, missing, plan


def _blocks(project: Project, start: int, end: int, **over: Any) -> list[Any]:
    plan = plan_audio(project, start, end)
    sources: dict[str, Any] = over.pop("sources", {"a1": ToneSource()})
    return list(
        mix_audio(
            plan,
            sources=lambda asset_id, source: sources.get(asset_id),
            resampler=over.pop("resampler", CountingResampler()),
            info=over.pop("info", lambda asset_id, source: _probe()),
            **over,
        )
    )


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


class TestPlanning:
    """The plan is a value: pure, total, and describable without a decoder."""

    def test_a_muted_track_is_silent_and_a_hidden_one_is_not(self) -> None:
        """Muting is about sound; hiding is about the picture.

        They are separate flags on a track, and an audio engine that treated
        them alike would silence a track the user only meant to stop looking
        at.
        """
        muted = _project(_track("v1", _clip("c1"), muted=True))
        hidden = _project(_track("v1", _clip("c1"), hidden=True))
        assert plan_audio(muted, 0, 30).segments == ()
        assert len(plan_audio(hidden, 0, 30).segments) == 1

    def test_a_disabled_clip_contributes_nothing(self) -> None:
        on, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60))), 0, 30)
        off, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60, enabled=False))), 0, 30)
        assert np.any(on.samples != 0.0)
        assert np.all(off.samples == 0.0)

    def test_a_file_with_no_audio_stream_is_dropped_at_planning_time(self) -> None:
        """A picture with no soundtrack is a fact about the file, not a
        failure to report once per block."""
        asset = MediaAsset(asset_id=EntityId("a1"), path="/a1.mp4", probe=_probe(with_audio=False))
        plan = plan_audio(_project(_track("v1", _clip("c1")), assets=(asset,)), 0, 30)
        assert plan.segments == ()
        assert plan.is_empty

    def test_an_unprobed_asset_is_kept_because_silence_would_be_a_guess(self) -> None:
        asset = MediaAsset(asset_id=EntityId("a1"), path="/a1.mp4")
        project = _project(_track("v1", _clip("c1")), assets=(asset,))
        assert len(plan_audio(project, 0, 30).segments) == 1

    def test_the_window_is_clipped_to_the_range_that_was_asked_for(self) -> None:
        """A block asks for a second of a clip and gets a second of a clip,
        source window and all, rather than the whole clip and a puzzle."""
        plan = plan_audio(_project(_track("v1", _clip("c1", source=300))), 30, 60)
        (segment,) = plan.segments
        assert (segment.start_frame, segment.end_frame) == (30, 60)
        assert segment.source_frames == 30

    def test_a_reverse_clip_stores_an_ascending_window_and_says_so(self) -> None:
        """A decoder is asked for a range, never for a direction.

        Carrying a direction inside a frame number is how a reverse clip gets
        read from the wrong end.
        """
        plan = plan_audio(_project(_track("v1", _clip("c1", source=60, speed=-1))), 0, 30)
        (segment,) = plan.segments
        assert segment.reversed
        assert segment.source_start_frame < segment.source_end_frame

    def test_a_range_past_the_end_is_clamped_rather_than_refused(self) -> None:
        plan = plan_audio(_project(_track("v1", _clip("c1", source=60))), 0, 10_000)
        assert plan.end_frame == 60

    def test_a_plan_that_runs_backwards_is_a_caller_bug(self) -> None:
        with pytest.raises(Exception, match="must not precede"):
            plan_audio(_project(_track("v1", _clip("c1"))), 60, 30)

    def test_the_sample_count_comes_from_the_range_and_not_from_the_segments(self) -> None:
        """Two adjacent blocks must agree where their boundary is."""
        plan = plan_audio(_project(_track("v1", _clip("c1", source=300))), 0, 300)
        assert plan.sample_count == 300 * SAMPLES_PER_FRAME

    def test_a_clip_the_user_has_never_touched_carries_nothing(self) -> None:
        """Neutral is zero everywhere, so a neutral setting is no binding.

        Most clips in most projects are never dressed, and a project's document
        is a thing a user diffs.
        """
        project = _project(_track("v1", _clip("c1", source=60)))
        assert project.audio == ()
        assert project.audio_for("c1") == ClipAudio()
        assert project.audio_for("c1").is_neutral


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------


class TestPlacement:
    """A sample lands on the frame it belongs to, and nowhere else."""

    def test_a_clip_starting_at_frame_30_is_silent_before_it(self) -> None:
        buffer, _, _, _ = _mix(_project(_track("v1", _clip("c1", start=30, source=60))), 0, 60)
        silence = buffer.samples[: 30 * SAMPLES_PER_FRAME]
        assert np.all(silence == 0.0)
        assert np.any(buffer.samples[30 * SAMPLES_PER_FRAME :] != 0.0)

    def test_the_first_sample_of_a_clip_is_the_first_sample_of_its_source(self) -> None:
        """Placement, in one line.

        Everything else about sync is this property repeated four hundred
        thousand times, which is why it is the one this file insists on.
        """
        buffer, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60))), 0, 30)
        assert buffer.samples[0, 0] == pytest.approx(float(_tone(np.float32(0))), abs=1e-5)

    def test_a_clip_that_starts_mid_block_lands_mid_block(self) -> None:
        """The offset is a sample count, not a block count.

        A mixer that placed a clip at the nearest block boundary would be half a
        packet late, which is a click at every cut.
        """
        buffer, _, _, _ = _mix(_project(_track("v1", _clip("c1", start=7, source=60))), 0, 30)
        at = 7 * SAMPLES_PER_FRAME
        assert np.all(buffer.samples[:at] == 0.0)
        assert buffer.samples[at, 0] != 0.0

    def test_two_tracks_sum_rather_than_replace(self) -> None:
        one, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60))), 0, 30)
        two, _, _, _ = _mix(
            _project(
                _track("v1", _clip("c1", source=60)),
                _track("v2", _clip("c2", source=60, asset_id="a2")),
            ),
            0,
            30,
            sources={"a1": ToneSource(), "a2": ToneSource()},
        )
        assert np.allclose(two.samples, one.samples + one.samples, atol=1e-5)

    def test_a_trimmed_clip_reads_the_part_of_the_source_it_shows(self) -> None:
        """`in_frame` is where the sound starts, not just the picture."""
        whole, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=600))), 0, 30)
        trimmed, _, _, _ = _mix(
            _project(_track("v1", _clip("c1", source=600).trimmed(in_frame=30))), 0, 30
        )
        assert whole.samples[0, 0] == pytest.approx(float(_tone(np.float32(0))), abs=1e-5)
        assert trimmed.samples[0, 0] == pytest.approx(
            float(_tone(np.float32(30 * SAMPLES_PER_FRAME))), abs=1e-4
        )


# ---------------------------------------------------------------------------
# Retiming
# ---------------------------------------------------------------------------


class TestRetiming:
    """Speed changes the sound, not the length of the edit."""

    def test_double_speed_reads_twice_the_source_for_the_same_frames(self) -> None:
        project = _project(_track("v1", _clip("c1", source=60, speed=2)))
        (segment,) = plan_audio(project, 0, 30).segments
        assert segment.source_frames == 60
        assert (segment.source_start_frame, segment.source_end_frame) == (0, 60)
        # And the edit is still thirty frames long, which is the length a
        # timeline must not change when a speed does.
        assert plan_audio(project, 0, 30).sample_count == 30 * SAMPLES_PER_FRAME

    def test_a_reversed_clip_plays_its_source_backwards(self) -> None:
        """The first thing you hear is the last thing that was recorded."""
        forward, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60))), 0, 10)
        backward, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60, speed=-1))), 0, 10)
        assert forward.frame_count == backward.frame_count
        assert np.all(np.diff(forward.samples[:4000, 0]) >= -1e-6)
        assert np.all(np.diff(backward.samples[:4000, 0]) <= 1e-6)

    def test_a_reversed_clip_still_fills_the_frames_it_was_given(self) -> None:
        buffer, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60, speed=-1))), 0, 60)
        assert buffer.frame_count == 60 * SAMPLES_PER_FRAME
        assert buffer.samples[-1, 0] != 0.0

    def test_the_last_frame_of_a_reversed_clip_is_the_first_frame_of_its_source(self) -> None:
        buffer, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60, speed=-1))), 0, 60)
        # Sixty frames of source played backwards: the final sample is the
        # source's opening one, give or take the resampler's delay.
        assert buffer.samples[-1, 0] == pytest.approx(float(_tone(np.float32(0))), abs=2e-3)


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------


class TestBlocks:
    """A block is the unit of memory, of cancellation and of progress."""

    def test_mixing_in_blocks_gives_the_samples_mixing_in_one_gives(self) -> None:
        """This is the lip-sync test.

        Every block anchors itself to the plan, so a range mixed in thirty
        blocks is the same array as one mixed in a single block. A mixer that
        carried a running sample count instead would drift by up to half a
        sample per segment, and no ten-second test would ever show it — which
        is precisely why this one is three hundred frames long.
        """
        project = _project(_track("v1", _clip("c1", source=300)))
        whole, _, _, _ = _mix(project, 0, 300)
        pieces = [block.buffer.samples for block in _blocks(project, 0, 300, block_frames=10)]
        assert len(pieces) == 30
        assert np.array_equal(np.concatenate(pieces, axis=0), whole.samples)

    def test_a_block_covers_the_frames_it_says_and_the_last_one_is_short(self) -> None:
        project = _project(_track("v1", _clip("c1", source=100)))
        blocks = _blocks(project, 0, 100, block_frames=30)
        assert [(block.start_frame, block.end_frame) for block in blocks[:2]] == [(0, 30), (30, 60)]
        assert blocks[-1].end_frame == 100
        assert blocks[-1].duration_frames == 10

    def test_cancelling_stops_between_blocks_and_never_inside_one(self) -> None:
        project = _project(_track("v1", _clip("c1", source=300)))
        allowed = 2
        seen = 0

        def cancel() -> bool:
            nonlocal seen
            seen += 1
            return seen > allowed

        blocks = _blocks(project, 0, 300, block_frames=30, cancel=cancel)
        # Two whole blocks and no third: a half-mixed block is a click the user
        # did not ask for.
        assert len(blocks) == 2
        assert blocks[-1].end_frame == 60

    def test_an_empty_plan_yields_nothing_at_all(self) -> None:
        """Silence, distinguished from a block of silence."""
        project = _project(_track("v1", _clip("c1"), muted=True))
        assert _blocks(project, 0, 30) == []

    def test_a_block_that_is_not_a_whole_number_of_frames_is_still_placed(self) -> None:
        """Frames do not have to divide the sample rate evenly.

        At 30000/1001 a frame is 1601.6 samples, so every boundary is a
        fraction; the mixer rounds each one from the frame rather than
        accumulating, which is the whole of why this works.
        """
        odd = Project(
            project_id=EntityId("p1"),
            name="Demo",
            settings=ProjectSettings(
                frame_size=FrameSize(width=1920, height=1080),
                sample_rate=RATE,
                channels=CHANNELS,
            ),
            timeline=Timeline.of(
                _track("v1", _clip("c1", source=60)), timebase=Timebase.of(30000, 1001)
            ),
        )
        whole, _, _, _ = _mix(odd, 0, 60)
        pieces = [block.buffer.samples for block in _blocks(odd, 0, 60, block_frames=7)]
        joined = np.concatenate(pieces, axis=0)
        # The length is the property: not one sample more or fewer than the
        # whole mix, which is what "no drift" means. The values are close
        # rather than identical, because a 30 fps file in a 29.97 project is
        # resampled and each block's ratio rounds differently — the rounding is
        # in the resampler's rate, never in the position.
        assert joined.shape == whole.samples.shape
        assert np.allclose(joined, whole.samples, atol=1e-3)


# ---------------------------------------------------------------------------
# Gain, fades and pan
# ---------------------------------------------------------------------------


class TestDressing:
    """The four things a user reaches for on a clip they can hear."""

    def test_a_gain_in_decibels_is_an_amplitude_ratio(self) -> None:
        """``20 · log10``, not ``10 · log10``: audio counts amplitude.

        Getting this the wrong way round is the most common bug in audio code,
        and it is only noticed when a mix is quiet.
        """
        assert db_to_linear(0.0) == 1.0
        assert db_to_linear(6.0) == pytest.approx(1.9953, abs=1e-4)
        assert linear_to_db(1.0) == 0.0
        assert linear_to_db(0.0) == -60.0

    def test_six_decibels_is_roughly_double_the_amplitude(self) -> None:
        flat, _, _, _ = _mix(_project(_track("v1", _clip("c1", source=60))), 0, 10)
        louder, _, _, _ = _mix(_dressed(ClipAudio(gain_db=6.0)), 0, 10)
        ratio = louder.samples[-1, 0] / flat.samples[-1, 0]
        assert ratio == pytest.approx(2.0, abs=0.02)

    def test_a_fade_in_starts_at_silence_and_ends_at_full_level(self) -> None:
        buffer, _, _, _ = _mix(_dressed(ClipAudio(fade_in_frames=30)), 0, 60)
        assert abs(float(buffer.samples[0, 0])) < 1e-3
        middle = 30 * SAMPLES_PER_FRAME
        assert buffer.samples[middle, 0] == pytest.approx(
            float(_tone(np.float32(middle))), abs=1e-4
        )

    def test_a_fade_out_reaches_silence_at_the_end_of_the_clip(self) -> None:
        buffer, _, _, _ = _mix(_dressed(ClipAudio(fade_out_frames=30)), 0, 60)
        assert abs(float(buffer.samples[-1, 0])) < 1e-3
        begin = 29 * SAMPLES_PER_FRAME
        assert abs(float(buffer.samples[begin, 0])) > 1e-2

    def test_a_fade_belongs_to_the_clip_not_to_the_block_that_covers_it(self) -> None:
        """Measured from the clip's head, even when the block starts later.

        This is why a segment carries both its own window and its clip's: the
        block [30, 60) of a clip with a thirty-frame fade in starts *at full
        level*, because the fade finished before the block began.
        """
        faded, _, _, _ = _mix(_dressed(ClipAudio(fade_in_frames=30), source=600), 30, 60)
        plain, _, _, _ = _mix(_dressed(ClipAudio(), source=600), 30, 60)
        # Bit for bit the same block: the fade had finished before this one
        # began, so a fade measured from the block rather than from the clip
        # would have faded in again here, thirty frames late.
        assert np.allclose(faded.samples, plain.samples, atol=1e-6)
        assert faded.samples[0, 0] > 1e-2

    def test_a_pan_moves_energy_between_the_channels(self) -> None:
        left, _, _, _ = _mix(_dressed(ClipAudio(pan=-1.0)), 0, 30)
        right, _, _, _ = _mix(_dressed(ClipAudio(pan=1.0)), 0, 30)
        assert float(np.abs(left.samples[:, 1]).mean()) == pytest.approx(0.0, abs=1e-6)
        assert float(np.abs(right.samples[:, 0]).mean()) == pytest.approx(0.0, abs=1e-6)
        assert float(np.abs(left.samples[:, 0]).mean()) > 0.0

    def test_a_pan_does_not_change_loudness(self) -> None:
        """Equal power: a clip panned hard left is not quieter than one panned
        to the centre, which is what a linear pan would do."""
        centred, _, _, _ = _mix(_dressed(ClipAudio(pan=0.0)), 0, 30)
        panned, _, _, _ = _mix(_dressed(ClipAudio(pan=-1.0)), 0, 30)
        assert float(np.abs(panned.samples[:, 0]).mean()) == pytest.approx(
            float(np.abs(centred.samples[:, 0]).mean()), rel=1e-3
        )

    def test_the_vectorised_curve_is_the_domain_curve(self) -> None:
        """Two implementations of one definition.

        The domain's is readable, exact at both ends and testable without
        NumPy; the service's is what a million samples need. Nothing but this
        test keeps them the same shape.
        """
        from nova_studio.services.render.audio import _curve

        samples = np.linspace(0.0, 1.0, 64, dtype=np.float64)
        for shape in FadeShape:
            for rising in (True, False):
                assert np.allclose(
                    _curve(shape, samples, rising=rising),
                    [fade_factor(shape, float(t), rising=rising) for t in samples],
                    atol=1e-6,
                ), shape

    def test_every_curve_starts_at_silence_and_ends_at_unity(self) -> None:
        """A fade never leaves a clip a fraction quieter than it was before it
        had one, and never a fraction louder."""
        for shape in FadeShape:
            assert fade_factor(shape, 0.0, rising=True) == 0.0
            assert fade_factor(shape, 1.0, rising=True) == 1.0
            assert fade_factor(shape, 0.0, rising=False) == 1.0
            assert fade_factor(shape, 1.0, rising=False) == 0.0

    def test_a_setting_on_a_clip_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(Exception, match="no clip"):
            _project(_track("v1", _clip("c1", source=60))).with_audio("nope", ClipAudio())

    def test_deleting_the_clip_takes_its_fades_with_it(self) -> None:
        project = _dressed(ClipAudio(gain_db=6.0))
        assert project.audio != ()
        assert project.with_timeline(Timeline.of(_track("v1"), timebase=TB)).audio == ()


# ---------------------------------------------------------------------------
# Failure and safety
# ---------------------------------------------------------------------------


class TestFailure:
    """A render does not stop for one unreadable clip."""

    def test_a_missing_file_is_reported_and_not_raised(self) -> None:
        buffer, stats, missing, _ = _mix(
            _project(_track("v1", _clip("c1", source=60))), 0, 30, sources={}
        )
        assert missing == ("a1",)
        assert stats.missing > 0
        assert buffer.frame_count == 30 * SAMPLES_PER_FRAME
        assert np.all(buffer.samples == 0.0)

    def test_a_file_with_no_audio_stream_is_counted_but_not_missing(self) -> None:
        buffer, stats, missing, _ = _mix(
            _project(_track("v1", _clip("c1", source=60))),
            0,
            30,
            info=lambda asset_id, source: _probe(with_audio=False),
        )
        assert missing == ()
        assert stats.silent_sources > 0
        assert np.all(buffer.samples == 0.0)

    def test_a_failed_read_is_reported_at_the_block_that_found_it(self) -> None:
        blocks = _blocks(
            _project(_track("v1", _clip("c1", source=60))),
            0,
            30,
            sources={"a1": SilentSource()},
        )
        assert blocks[0].error is not None
        assert blocks[0].error.code == "NS-MEDIA-4001"
        # The block still exists and is still the right length: a render that
        # stopped for one unreadable clip would throw away an hour of pictures
        # to protect thirty seconds of sound.
        assert blocks[0].buffer.frame_count == 30 * SAMPLES_PER_FRAME

    def test_loud_clips_are_bent_rather_than_clipped(self) -> None:
        """A file Nova Studio writes never contains digital clipping.

        Digital clipping is the one audio failure a listener can hear from
        another room, so the safety net is not optional.
        """
        buffer, stats, _, _ = _mix(_dressed(ClipAudio(gain_db=40.0)), 0, 30)
        assert float(np.max(np.abs(buffer.samples))) <= 1.0
        assert stats.clipped > 0
        assert stats.peak > 1.0

    def test_a_quiet_mix_is_left_untouched(self) -> None:
        from nova_studio.services.render.audio import _soft_clip

        quiet = np.full((64, 2), 0.1, dtype=np.float32)
        assert np.array_equal(_soft_clip(quiet), quiet)

    def test_the_soft_clip_never_exceeds_the_ceiling(self) -> None:
        from nova_studio.services.render.audio import _soft_clip

        loud = np.linspace(-8.0, 8.0, 4096, dtype=np.float32).reshape(-1, 1)
        bent = _soft_clip(loud)
        assert float(np.max(np.abs(bent))) <= 1.0
        # Monotonic: a limiter that let a louder input come out quieter would
        # be a limiter that inverted the peaks it was meant to catch.
        assert np.all(np.diff(bent[:, 0]) >= -1e-6)


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------


class TestRoundTrip:
    """What a user sets survives being saved."""

    def test_a_clip_audio_survives_a_round_trip_through_the_project(self) -> None:
        project = _dressed(
            ClipAudio(
                gain_db=-6.0,
                pan=0.5,
                fade_in_frames=12,
                fade_out_frames=24,
                fade_shape=FadeShape.S_CURVE,
            )
        )
        rebuilt = Project.from_wire(project.to_wire())
        assert rebuilt.audio == project.audio
        assert rebuilt.audio_for("c1").fade_shape is FadeShape.S_CURVE

    def test_a_neutral_clip_audio_survives_too(self) -> None:
        project = _project(_track("v1", _clip("c1", source=60)))
        assert Project.from_wire(project.to_wire()).audio == ()

    def test_a_document_from_a_newer_build_is_refused_rather_than_trimmed(self) -> None:
        """A field this build does not know is an error, not a silent drop.

        A fade that stopped existing because a newer build named something
        extra is the exact bug this refusal exists to prevent.
        """
        wire = _dressed(ClipAudio(gain_db=-6.0)).to_wire()
        entry = wire["audio"][0]
        assert isinstance(entry, dict)
        entry["loudness_target"] = -23.0
        with pytest.raises(Exception, match="loudness_target"):
            Project.from_wire(wire)

    def test_replacing_a_setting_replaces_it_rather_than_adding_one(self) -> None:
        project = _dressed(ClipAudio(gain_db=-6.0))
        twice = project.with_audio("c1", ClipAudio(gain_db=-3.0))
        assert len(twice.audio) == 1
        assert twice.audio_for("c1").gain_db == -3.0

    def test_removing_a_setting_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(Exception, match="to remove"):
            _project(_track("v1", _clip("c1", source=60))).without_audio("c1")
