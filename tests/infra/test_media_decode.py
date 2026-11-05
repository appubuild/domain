"""`infra/media.py` — the PyAV decoder, against files PyAV itself encoded.

The files are made here rather than committed, for the same reason as the probe
tests: a media fixture in a repository is a file nobody can regenerate when the
toolchain moves. `tests/media/encoding.py` makes them, and the test clip is
built so that a frame that came back out of order would show it — every frame is
a flat colour derived from its own number.

What is being pinned is what the port promises and what an adapter is tempted to
break:

* **A frame is the domain's frame.** RGB24 `uint8`, or the `FrameBuffer`
  constructor refuses it — so this is really a test that decoding never hands
  the timeline something it has to convert.
* **Random access answers the same picture as a sequential walk.** Seeking back
  to a keyframe and decoding forwards is one implementation of `frame_at`; the
  contract is that frame 15 by seek and frame 15 by walk are the same pixels.
* **A read is self-contained.** A keyframe scan walks the whole container, and a
  decode demuxes the streams you did not ask for; a source that quietly resumed
  where the last one stopped would return the wrong frames to the next caller.
* **Blocks, not samples, and never split.** Audio comes back as the decoder
  produced it, which is what a render job wants to write straight into a muxer.
* **A decode failure is a value on the source, not an exception in the hot
  path.** `last_error` is the channel, because an iterator has no `Result`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import AudioBuffer, FrameBuffer
from nova_studio.infra.media import (
    PyAVDecoder,
    PyAVProber,
    PyAVResampler,
)
from nova_studio.ports.media import (
    AudioResampler,
    AudioSampleSource,
    DecodedMedia,
    MediaDecoder,
    MediaErrorCode,
    VideoFrameSource,
)
from tests.media.encoding import (
    FRAMES,
    HEIGHT,
    SAMPLE_RATE,
    WIDTH,
    write_audio_only,
    write_pcm16_wav,
    write_still,
    write_video,
)

if TYPE_CHECKING:
    from pathlib import Path

pytest.importorskip("av", reason="PyAV is the adapter under test")
av = pytest.importorskip("av")

pytestmark = [pytest.mark.unit, pytest.mark.media]


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_video(tmp_path_factory.mktemp("media") / "clip.mov")


@pytest.fixture(scope="module")
def gop_clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A clip with a keyframe every ten frames, so there is somewhere to seek."""
    return write_video(tmp_path_factory.mktemp("media") / "gop.mov", gop=10)


@pytest.fixture(scope="module")
def still(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_still(tmp_path_factory.mktemp("media") / "frame.png")


@pytest.fixture(scope="module")
def audio_only(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_audio_only(tmp_path_factory.mktemp("media") / "voice.m4a")


@pytest.fixture(scope="module")
def pcm_wav(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_pcm16_wav(tmp_path_factory.mktemp("media") / "tone.wav")


@pytest.fixture
def decoder() -> PyAVDecoder:
    return PyAVDecoder()


@pytest.fixture
def prober_like() -> PyAVProber:
    """The other half of the adapter, for the test that says the two agree."""
    return PyAVProber()


@pytest.fixture
def media(decoder: PyAVDecoder, clip: Path) -> Any:
    """An open handle on the test clip, closed when the test ends."""
    handle = decoder.open(str(clip)).unwrap()
    yield handle
    handle.close()


# ---------------------------------------------------------------------------
# Doubles
# ---------------------------------------------------------------------------


class _BrokenContainer:
    """Stands in for the container a source holds: seeking decodes nothing.

    A decode that fails mid-stream is the one thing a test cannot produce from a
    well-formed file — truncate an MP4 and you get an unreadable file, not a
    damaged one — so it is produced here instead.
    """

    def __init__(self, error: Exception, *, on: str = "decode") -> None:
        self._error = error
        self._on = on
        self.closed = False

    def decode(self, stream: Any) -> Any:
        if self._on == "decode":
            raise self._error
        return iter(())

    def seek(self, *args: Any, **kwargs: Any) -> None:
        if self._on == "seek":
            raise self._error

    def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# Opening
# ---------------------------------------------------------------------------


class TestOpening:
    """`open` is either a handle or a reason, never both and never an exception."""

    def test_the_handle_speaks_the_port(self, decoder: PyAVDecoder, clip: Path) -> None:
        """Structural typing is checked by mypy; this checks the shape at runtime."""
        assert isinstance(decoder, MediaDecoder)
        handle = decoder.open(str(clip)).unwrap()
        try:
            assert isinstance(handle, DecodedMedia)
            assert isinstance(handle.video(), VideoFrameSource)
            assert isinstance(handle.audio(), AudioSampleSource)
        finally:
            handle.close()

    def test_a_decoder_describes_a_file_the_same_way_a_prober_does(
        self, decoder: PyAVDecoder, prober_like: PyAVProber, clip: Path
    ) -> None:
        """One description, not two.

        A prober and a decoder that disagreed about what a file contains would
        produce a timeline that lays a clip out at the wrong size.
        """
        handle = decoder.open(str(clip)).unwrap()
        try:
            assert handle.info() == prober_like.probe(str(clip)).unwrap()
        finally:
            handle.close()

    def test_a_file_that_is_not_there_is_unreadable(
        self, decoder: PyAVDecoder, tmp_path: Path
    ) -> None:
        error = decoder.open(str(tmp_path / "missing.mov")).unwrap_err()
        assert error.code == MediaErrorCode.UNREADABLE

    def test_a_directory_is_unreadable(self, decoder: PyAVDecoder, tmp_path: Path) -> None:
        assert decoder.open(str(tmp_path)).unwrap_err().code == MediaErrorCode.UNREADABLE

    def test_a_file_that_is_not_media_is_unreadable(
        self, decoder: PyAVDecoder, tmp_path: Path
    ) -> None:
        notes = tmp_path / "notes.txt"
        notes.write_text("this is not footage", encoding="utf-8")
        assert decoder.open(str(notes)).unwrap_err().code == MediaErrorCode.UNREADABLE

    def test_an_empty_path_is_unreadable(self, decoder: PyAVDecoder) -> None:
        """Refused before it reaches FFmpeg, which would open the working directory."""
        assert decoder.open("").unwrap_err().code == MediaErrorCode.UNREADABLE

    def test_a_codec_this_build_lacks_is_our_problem(
        self, decoder: PyAVDecoder, clip: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`4003`, not `4001`: the file is fine, this build is not."""
        monkeypatch.setattr(av, "codecs_available", frozenset())
        error = decoder.open(str(clip)).unwrap_err()
        assert error.code == MediaErrorCode.UNSUPPORTED
        assert error.details == {"codec": "h264"}

    def test_a_file_without_picture_has_no_video_source(
        self, decoder: PyAVDecoder, audio_only: Path
    ) -> None:
        handle = decoder.open(str(audio_only)).unwrap()
        try:
            assert handle.video() is None
            assert handle.audio() is not None
        finally:
            handle.close()

    def test_a_still_has_one_frame_and_no_audio(self, decoder: PyAVDecoder, still: Path) -> None:
        handle = decoder.open(str(still)).unwrap()
        try:
            source = handle.video()
            assert source is not None
            assert source.frame_count() == 1
            assert handle.audio() is None
        finally:
            handle.close()

    def test_a_stream_that_is_not_there_is_none(self, media: Any) -> None:
        """Asking for stream 9 is a question, not an error; `None` is the answer."""
        assert media.video(stream_index=9) is None
        assert media.audio(stream_index=9) is None

    def test_two_handles_on_one_file_read_independently(
        self, decoder: PyAVDecoder, clip: Path
    ) -> None:
        """The pool's contract (ADR-0007 §5): one handle per task, not one per file.

        A handle that held global state would make the second reader start where
        the first one stopped.
        """
        first = decoder.open(str(clip)).unwrap()
        second = decoder.open(str(clip)).unwrap()
        try:
            assert len(list(first.video().frames())) == FRAMES
            assert len(list(second.video().frames())) == FRAMES
        finally:
            first.close()
            second.close()


# ---------------------------------------------------------------------------
# Video frames
# ---------------------------------------------------------------------------


def _mean_of(buffer: FrameBuffer) -> float:
    """The flat colour the frame was encoded with, as a number."""
    return float(buffer.pixels.mean())


class TestVideoFrames:
    """A frame is the domain's frame, and frame 15 by seek is frame 15 by walk."""

    def test_a_walk_yields_every_frame_as_the_domain_wants_them(self, media: Any) -> None:
        frames = list(media.video().frames())
        assert len(frames) == FRAMES
        assert all(isinstance(frame, FrameBuffer) for frame in frames)
        # The `FrameBuffer` constructor refuses anything else, so these are
        # assertions about the adapter agreeing with the domain, not about
        # NumPy: RGB24 uint8 is the only pixel format a consumer ever sees.
        assert all(frame.width == WIDTH for frame in frames)
        assert all(frame.height == HEIGHT for frame in frames)
        assert all(frame.channels == 3 for frame in frames)
        assert frames[0].pixels.dtype.name == "uint8"

    def test_the_picture_is_the_one_that_was_encoded(self, media: Any) -> None:
        """The clip's frame `i` is the flat colour `i * 7 % 255`.

        Decoded through h264, so approximately — but a frame out of order, or a
        source stuck on one frame, would be nowhere near.
        """
        source = media.video()
        expected = [index * 7 % 255 for index in range(FRAMES)]
        actual = [_mean_of(frame) for frame in source.frames()]
        assert all(abs(a - b) < 4 for a, b in zip(actual, expected, strict=True))

    def test_a_random_read_answers_the_same_picture_as_a_walk(self, media: Any) -> None:
        source = media.video()
        sequential = list(source.frames())
        for index in (0, 1, 15, 20, FRAMES - 1):
            sought = source.frame_at(index)
            assert sought is not None
            assert (sought.pixels == sequential[index].pixels).all()

    def test_a_read_past_the_end_is_none_not_an_error(self, media: Any) -> None:
        """The end of a clip is not a failure; it is the end of a clip."""
        assert media.video().frame_at(FRAMES) is None
        assert media.video().frame_at(-1) is None

    def test_a_window_reads_exactly_the_frames_asked_for(self, media: Any) -> None:
        source = media.video()
        sequential = list(source.frames())
        window = list(source.frames(10, 15))
        assert len(window) == 5
        assert all(
            (a.pixels == b.pixels).all() for a, b in zip(window, sequential[10:15], strict=True)
        )

    def test_an_empty_window_yields_nothing(self, media: Any) -> None:
        assert list(media.video().frames(10, 10)) == []
        assert len(list(media.video().frames(5))) == FRAMES - 5

    def test_the_colour_a_frame_decodes_as_is_the_colour_the_probe_reported(
        self, media: Any
    ) -> None:
        """Two answers to one question, from one file.

        If the tags on a decoded frame said something different from the tags on
        the stream header, a colour-managed pipeline would grade a clip by a
        space it was not decoded in.
        """
        source = media.video()
        frame = next(iter(source.frames()))
        assert frame.colour == source.info().colour

    def test_a_keyframe_scan_does_not_consume_the_clip(self, media: Any) -> None:
        """The regression this file exists for.

        `keyframe_indices` demuxes the container to its end. A source that then
        answered a fresh walk from where the scan left off would yield nothing.
        """
        source = media.video()
        assert list(source.keyframe_indices()) == [0]
        assert len(list(source.frames())) == FRAMES

    def test_keyframes_are_where_a_seek_can_land(
        self, decoder: PyAVDecoder, gop_clip: Path
    ) -> None:
        handle = decoder.open(str(gop_clip)).unwrap()
        try:
            source = handle.video()
            keyframes = list(source.keyframe_indices())
            assert keyframes == [0, 10, 20]
            sequential = list(source.frames())
            for index in keyframes:
                sought = source.frame_at(index)
                assert sought is not None
                assert (sought.pixels == sequential[index].pixels).all()
        finally:
            handle.close()

    def test_a_frame_inside_a_gop_costs_the_gop_and_no_more(
        self, decoder: PyAVDecoder, gop_clip: Path
    ) -> None:
        """Frame 15 has no keyframe of its own; it is still frame 15."""
        handle = decoder.open(str(gop_clip)).unwrap()
        try:
            source = handle.video()
            sequential = list(source.frames())
            sought = source.frame_at(15)
            assert sought is not None
            assert (sought.pixels == sequential[15].pixels).all()
        finally:
            handle.close()

    def test_a_good_read_latches_no_error(self, media: Any) -> None:
        source = media.video()
        list(source.frames())
        assert source.last_error() is None
        source.frame_at(3)
        assert source.last_error() is None

    def test_a_decode_failure_ends_the_read_and_is_latched(
        self, media: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An iterator has no `Result`, so the source carries the error instead.

        Frames already yielded stay valid — a render job keeps what it decoded
        and reports where it stopped.
        """
        source = media.video()
        reason = av.error.InvalidDataError(1094995529, "Invalid data found when processing input")
        monkeypatch.setattr(source, "_container", _BrokenContainer(reason))
        assert list(source.frames()) == []
        error = source.last_error()
        assert error is not None
        assert error.code == MediaErrorCode.DECODE_FAILED
        assert error.retryable is False
        assert "Invalid data" in str(error.cause)

    def test_a_failed_seek_names_the_position_it_was_going_for(
        self, media: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = media.video()
        monkeypatch.setattr(
            source,
            "_container",
            _BrokenContainer(av.error.InvalidDataError(1094995529, "nope"), on="seek"),
        )
        assert source.frame_at(5) is None
        error = source.last_error()
        assert error is not None
        assert error.details == {"position": "5"}


# ---------------------------------------------------------------------------
# Audio samples
# ---------------------------------------------------------------------------


class TestAudioSamples:
    """Blocks of interleaved float32, in the order they were encoded."""

    def test_blocks_are_the_domain_s_buffer(self, media: Any) -> None:
        blocks = list(media.audio().samples())
        assert blocks
        assert all(isinstance(block, AudioBuffer) for block in blocks)
        assert all(block.samples.dtype.name == "float32" for block in blocks)
        assert all(block.channels == 2 for block in blocks)
        assert all(block.sample_rate == SAMPLE_RATE for block in blocks)

    def test_the_samples_are_interleaved_not_planar(self, media: Any) -> None:
        """(samples, channels), which is what a muxer and a peak meter both want.

        The decoder produces planar; the adapter is where that stops being
        anyone else's problem.
        """
        block = next(iter(media.audio().samples()))
        assert block.samples.shape[1] == 2
        assert block.samples.flags["C_CONTIGUOUS"]

    def test_the_waveform_comes_out_in_the_order_it_went_in(self, media: Any) -> None:
        """The clip's audio alternates silence and 0.1, block by block.

        A source that returned blocks out of order, or scaled them by something
        other than the nominal ±1.0, would show it here.
        """
        levels = [round(float(block.samples.mean()), 3) for block in media.audio().samples()]
        assert levels == [0.0, 0.1] * 5

    def test_a_read_reaches_the_end_of_the_stream(self, media: Any) -> None:
        source = media.audio()
        total = sum(block.frame_count for block in source.samples())
        # AAC priming: the container's own count and the decoded one differ by a
        # fraction of a packet, which is why this is a range and not an equality.
        assert abs(total - source.sample_count()) <= 1024

    def test_a_read_can_start_inside_the_stream(self, media: Any) -> None:
        source = media.audio()
        everything = sum(block.frame_count for block in source.samples())
        rest = sum(block.frame_count for block in source.samples(start=4096))
        assert rest == everything - 4096

    def test_a_count_is_a_maximum_and_never_splits_a_block(self, media: Any) -> None:
        blocks = list(media.audio().samples(count=3000))
        total = sum(block.frame_count for block in blocks)
        assert total >= 3000
        assert total - 3000 < blocks[-1].frame_count

    def test_asking_for_nothing_yields_nothing(self, media: Any) -> None:
        assert list(media.audio().samples(count=0)) == []

    def test_audio_that_is_not_float_arrives_as_float(
        self, decoder: PyAVDecoder, pcm_wav: Path
    ) -> None:
        """16-bit integer is every waveform's other half.

        Everything downstream — peaks, loudness, mixing, the export muxer — is
        written against float32 in ±1.0, so the conversion belongs here.
        """
        handle = decoder.open(str(pcm_wav)).unwrap()
        try:
            blocks = list(handle.audio().samples())
            assert blocks
            assert all(block.samples.dtype.name == "float32" for block in blocks)
            assert all(float(np.abs(block.samples).max()) <= 1.0 for block in blocks)
            # The WAV was encoded at 0.5 of full scale; swresample's mono to
            # stereo upmix attenuates by 3 dB, so it arrives at roughly 0.354.
            assert 0.3 < float(blocks[0].samples.mean()) < 0.4
        finally:
            handle.close()

    def test_a_good_read_latches_no_error(self, media: Any) -> None:
        source = media.audio()
        list(source.samples())
        assert source.last_error() is None

    def test_a_decode_failure_ends_the_read_and_is_latched(
        self, media: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = media.audio()
        reason = av.error.InvalidDataError(1094995529, "Invalid data found when processing input")
        monkeypatch.setattr(source, "_container", _BrokenContainer(reason))
        assert list(source.samples()) == []
        error = source.last_error()
        assert error is not None
        assert error.code == MediaErrorCode.DECODE_FAILED
        assert error.retryable is False

    def test_a_video_read_does_not_move_the_audio(self, media: Any) -> None:
        """One handle, two sources.

        `container.decode(video)` demuxes the whole file and drops the audio
        packets it read on the way, so a source that trusted the container's
        position would hand the audio back half-consumed.
        """
        list(media.video().frames())
        assert sum(block.frame_count for block in media.audio().samples()) > 0


# ---------------------------------------------------------------------------
# Closing
# ---------------------------------------------------------------------------


class TestClosing:
    """A handle owns native resources; closing it is the only way they go."""

    def test_closing_twice_is_one_close(self, decoder: PyAVDecoder, clip: Path) -> None:
        handle = decoder.open(str(clip)).unwrap()
        handle.close()
        handle.close()
        assert handle.is_closed

    def test_a_closed_handle_reads_nothing_and_raises_nothing(
        self, decoder: PyAVDecoder, clip: Path
    ) -> None:
        handle = decoder.open(str(clip)).unwrap()
        source = handle.video()
        audio = handle.audio()
        handle.close()
        assert list(source.frames()) == []
        assert source.frame_at(0) is None
        assert source.keyframe_indices() == ()
        assert list(audio.samples()) == []
        source.close()

    def test_closing_the_last_source_closes_the_handle(
        self, decoder: PyAVDecoder, clip: Path
    ) -> None:
        """Sources share one container, so the last one out turns out the light.

        A source that closed a stream it did not own would leave the file
        descriptor open for the lifetime of the project.
        """
        handle = decoder.open(str(clip)).unwrap()
        source = handle.video()
        source.close()
        assert handle.is_closed
        source.close()

    def test_a_closed_handle_hands_out_no_more_sources(
        self, decoder: PyAVDecoder, clip: Path
    ) -> None:
        """A handle evicted by the pool mid-task must answer a question, not hand
        back a source on a dead container."""
        handle = decoder.open(str(clip)).unwrap()
        handle.close()
        assert handle.video() is None
        assert handle.audio() is None

    def test_a_closed_handle_still_answers_what_it_read(
        self, decoder: PyAVDecoder, clip: Path
    ) -> None:
        """The probe summary is a value; it outlives the file it came from."""
        handle = decoder.open(str(clip)).unwrap()
        info = handle.info()
        handle.close()
        assert info.primary_video() is not None
        assert info.primary_video().width == WIDTH


# ---------------------------------------------------------------------------
# Resampling
# ---------------------------------------------------------------------------


def _tone(sample_rate: int, channels: int, seconds: float = 1.0) -> AudioBuffer:
    count = int(sample_rate * seconds)
    wave = (0.4 * np.sin(np.arange(count) / 20.0)).astype(np.float32)
    return AudioBuffer(samples=np.stack([wave] * channels, axis=1), sample_rate=sample_rate)


class TestResampler:
    """Rate and channel conversion, without leaking state between calls."""

    def test_the_resampler_speaks_the_port(self) -> None:
        assert isinstance(PyAVResampler(), AudioResampler)

    def test_a_rate_change_changes_the_length(self) -> None:
        buffer = _tone(SAMPLE_RATE, 2)
        out = PyAVResampler().resample(buffer, sample_rate=44_100, channels=2)
        assert out.sample_rate == 44_100
        assert out.channels == 2
        # Not equality: libswresample's output length is a property of its
        # filters, not a ratio a caller should be asked to compute.
        assert abs(out.frame_count - round(buffer.frame_count * 44_100 / SAMPLE_RATE)) <= 2

    def test_downmixing_keeps_the_samples_in_range(self) -> None:
        buffer = _tone(SAMPLE_RATE, 2)
        out = PyAVResampler().resample(buffer, sample_rate=SAMPLE_RATE, channels=1)
        assert out.channels == 1
        assert out.frame_count == buffer.frame_count
        assert float(out.samples.max()) <= 1.0

    def test_upmixing_duplicates_the_channel(self) -> None:
        buffer = _tone(SAMPLE_RATE, 1)
        out = PyAVResampler().resample(buffer, sample_rate=SAMPLE_RATE, channels=2)
        assert out.channels == 2
        assert float(out.samples[:, 0].mean()) == pytest.approx(
            float(out.samples[:, 1].mean()), abs=1e-6
        )

    def test_resampling_to_what_it_already_is_changes_nothing(self) -> None:
        buffer = _tone(SAMPLE_RATE, 2)
        out = PyAVResampler().resample(buffer, sample_rate=SAMPLE_RATE, channels=2)
        assert out.samples.shape == buffer.samples.shape
        assert float(np.abs(out.samples - buffer.samples).max()) < 1e-6

    def test_one_resampler_serves_many_targets(self) -> None:
        """Stateless from the caller's point of view.

        libswresample carries delay between calls, so a shared instance would
        leak the tail of one buffer into the head of the next.
        """
        resampler = PyAVResampler()
        buffer = _tone(SAMPLE_RATE, 2)
        resampler.resample(buffer, sample_rate=44_100, channels=1)
        second = resampler.resample(buffer, sample_rate=SAMPLE_RATE, channels=2)
        assert second.samples.shape == buffer.samples.shape
        assert float(np.abs(second.samples - buffer.samples).max()) < 1e-6

    def test_an_empty_buffer_resamples_to_an_empty_buffer(self) -> None:
        empty = AudioBuffer(samples=np.zeros((0, 2), dtype=np.float32), sample_rate=SAMPLE_RATE)
        out = PyAVResampler().resample(empty, sample_rate=44_100, channels=2)
        assert out.frame_count == 0
        assert out.channels == 2
        assert out.sample_rate == 44_100

    def test_a_target_that_is_not_a_rate_is_refused(self) -> None:
        """A domain invariant, raised: this is a bug in the caller, not bad audio."""
        buffer = _tone(SAMPLE_RATE, 2)
        with pytest.raises(NovaInvariantError, match="positive"):
            PyAVResampler().resample(buffer, sample_rate=0, channels=2)
        with pytest.raises(NovaInvariantError, match="positive"):
            PyAVResampler().resample(buffer, sample_rate=SAMPLE_RATE, channels=0)
