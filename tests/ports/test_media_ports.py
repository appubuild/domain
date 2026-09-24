"""The media port contract, driven by fakes that behave like a real adapter.

A port nobody can implement is a port nobody checked.  These tests provide the
smallest faithful doubles — a synthetic clip with a real frame rate, real
``FrameBuffer`` pixels and real ``AudioBuffer`` blocks — and then hold them to
the contract ``nova_studio/ports/media.py`` declares:

1. **Conformance.**  A structural double satisfies every protocol it should, so
   a future PyAV adapter can be swapped in without touching a consumer.
2. **Narrowness.**  A double that only decodes frames does *not* satisfy
   ``DecodedMedia``.  Asking for the least you need only means something if the
   wider protocol refuses a partial implementation.
3. **The declared limitation.**  ``runtime_checkable`` checks that a method
   *name* is present, not that it behaves.  That is pinned rather than
   papered over, with the failure pinned to the moment of the call.
4. **The error channel.**  Adapters answer I/O failure with ``Err`` carrying a
   :class:`MediaErrorCode`, never with an exception.

No FFmpeg, no files, no model: these are the tests that still run on a machine
with nothing installed.
"""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core import ErrorDomain, NovaError, Timebase, error_result, ok
from nova_studio.domain.media import (
    AssetKind,
    AudioBuffer,
    AudioStreamInfo,
    ColourMeta,
    ColourRange,
    ColourSpace,
    FrameBuffer,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.ports.media import (
    AudioResampler,
    AudioSampleSource,
    DecodedMedia,
    MediaDecoder,
    MediaErrorCode,
    MediaProber,
    VideoFrameSource,
)

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

pytestmark = pytest.mark.unit

WIDTH, HEIGHT = 64, 36
FRAME_COUNT = 12
BLOCK_SAMPLES = 1024


def _frame(index: int) -> FrameBuffer:
    """A deterministic synthetic frame: a horizontal ramp tagged BT.709."""
    row = np.linspace(0, 255, WIDTH, dtype=np.uint8)
    pixels = np.tile(row.reshape(1, WIDTH, 1), (HEIGHT, 1, 3))
    pixels[:, :, 0] = np.uint8(index)
    return FrameBuffer(
        pixels=pixels,
        colour=ColourMeta(space=ColourSpace.BT709, range=ColourRange.LIMITED),
    )


class FakeFrameSource:
    """A video stream that generates frames instead of decoding them."""

    def __init__(self, frame_count: int = FRAME_COUNT, *, fail_at: int | None = None) -> None:
        self._frame_count = frame_count
        self.closed = False
        self.seek_cost = 0
        self._last_index = 0
        self._fail_at = fail_at
        self._error: NovaError | None = None

    def info(self) -> VideoStreamInfo:
        return VideoStreamInfo(
            codec_name="rawvideo",
            width=WIDTH,
            height=HEIGHT,
            timebase=Timebase.of(30),
            frame_count=self._frame_count,
            pixel_format="rgb24",
        )

    def frame_count(self) -> int:
        return self._frame_count

    def frame_at(self, index: int) -> FrameBuffer | None:
        # A real adapter seeks to the previous keyframe and decodes forward;
        # recording that cost is what lets a test assert scrub behaviour.
        self.seek_cost += max(1, abs(index - self._last_index))
        self._last_index = index
        if index < 0 or index >= self._frame_count:
            return None
        if index == self._fail_at:
            self._error = NovaError(
                MediaErrorCode.DECODE_FAILED,
                "invalid data found when processing input",
                domain=ErrorDomain.MEDIA,
                details={"frame": index},
            )
            return None
        return _frame(index)

    def frames(self, start: int = 0, stop: int | None = None) -> Iterator[FrameBuffer]:
        self._error = None
        end = self._frame_count if stop is None else min(stop, self._frame_count)
        for index in range(max(0, start), end):
            if index == self._fail_at:
                self._error = NovaError(
                    MediaErrorCode.DECODE_FAILED,
                    "invalid data found when processing input",
                    domain=ErrorDomain.MEDIA,
                    details={"frame": index},
                )
                return
            yield _frame(index)

    def keyframe_indices(self) -> Sequence[int]:
        return tuple(range(0, self._frame_count, 5))

    def last_error(self) -> NovaError | None:
        return self._error

    def close(self) -> None:
        self.closed = True


class FakeAudioSource:
    """An audio stream emitted in decoder-sized blocks."""

    def __init__(self, sample_count: int = 48_000, channels: int = 2) -> None:
        self._sample_count = sample_count
        self._channels = channels
        self.closed = False

    def info(self) -> AudioStreamInfo:
        return AudioStreamInfo(
            codec_name="pcm_s16le",
            sample_rate=48_000,
            channels=self._channels,
            sample_count=self._sample_count,
        )

    def sample_count(self) -> int:
        return self._sample_count

    def last_error(self) -> NovaError | None:
        """This fake never corrupts; the video side exercises the channel."""
        return None

    def samples(self, start: int = 0, count: int | None = None) -> Iterator[AudioBuffer]:
        limit = self._sample_count if count is None else min(count, self._sample_count)
        emitted = 0
        start = max(0, start)
        while emitted < limit:
            size = min(BLOCK_SAMPLES, limit - emitted)
            mono = np.linspace(-1.0, 1.0, size, dtype=np.float32).reshape(-1, 1)
            block = np.repeat(mono, self._channels, axis=1)
            yield AudioBuffer(samples=block, sample_rate=48_000)
            emitted += size

    def close(self) -> None:
        self.closed = True


class FakeMedia:
    """An open file: one video stream, one audio stream."""

    def __init__(
        self,
        *,
        with_video: bool = True,
        with_audio: bool = True,
        fail_at: int | None = None,
    ) -> None:
        self._video = FakeFrameSource(fail_at=fail_at) if with_video else None
        self._audio = FakeAudioSource() if with_audio else None
        self.close_count = 0

    def info(self) -> MediaInfo:
        info = MediaInfo(
            kind=AssetKind.VIDEO,
            container_format="matroska,webm",
            duration_seconds=FRAME_COUNT / 30,
            video=(self._video.info(),) if self._video else (),
            audio=(self._audio.info(),) if self._audio else (),
        )
        return info

    def video(self, stream_index: int | None = None) -> VideoFrameSource | None:
        """Absent means absent: the caller cross-checks against ``info()``."""
        return self._video if stream_index in (None, 0) else None

    def audio(self, stream_index: int | None = None) -> AudioSampleSource | None:
        return self._audio if stream_index in (None, 1) else None

    def close(self) -> None:
        """Idempotent: a pool and a ``finally`` may both close the same handle."""
        self.close_count += 1
        if self._video:
            self._video.close()
        if self._audio:
            self._audio.close()


class FakeDecoder:
    """Opens the synthetic clip, or reports why it cannot."""

    def __init__(
        self,
        *,
        fail_with: MediaErrorCode | None = None,
        fail_at: int | None = None,
    ) -> None:
        self._fail_with = fail_with
        self._fail_at = fail_at

    def open(self, path: str) -> Any:
        if self._fail_with is MediaErrorCode.UNREADABLE:
            return error_result(
                MediaErrorCode.UNREADABLE,
                f"{path} does not exist",
                domain=ErrorDomain.MEDIA,
                remedy="Relink the asset to its current location.",
            )
        if self._fail_with is MediaErrorCode.UNSUPPORTED:
            return error_result(
                MediaErrorCode.UNSUPPORTED,
                "no decoder for codec prores_ks in this build",
                domain=ErrorDomain.MEDIA,
                remedy="Install the codec or switch to the FFmpeg CLI backend.",
            )
        return ok(FakeMedia(fail_at=self._fail_at))


class FakeProber:
    """Answers with the same summary the decoder would, without decoding."""

    def probe(self, path: str) -> Any:
        if path.endswith(".txt"):
            return error_result(
                MediaErrorCode.UNREADABLE,
                f"{path} is not a media file",
                domain=ErrorDomain.MEDIA,
            )
        return ok(FakeMedia().info())


class NaiveResampler:
    """Linear-interpolating resampler; accuracy is irrelevant, contract is not."""

    def resample(self, buffer: AudioBuffer, *, sample_rate: int, channels: int) -> AudioBuffer:
        if buffer.is_empty:
            return AudioBuffer(
                samples=np.zeros((0, channels), dtype=np.float32), sample_rate=sample_rate
            )
        source = buffer.samples
        duration = buffer.frame_count / buffer.sample_rate
        target_frames = max(1, round(duration * sample_rate))
        positions = np.linspace(0, buffer.frame_count - 1, target_frames, dtype=np.float32)
        left = np.interp(positions, np.arange(buffer.frame_count, dtype=np.float32), source[:, 0])
        mono = left.astype(np.float32).reshape(-1, 1)
        mixed = np.repeat(mono, channels, axis=1)
        return AudioBuffer(samples=mixed, sample_rate=sample_rate)


class TestProtocolConformance:
    """A structural double satisfies the port without importing it."""

    def test_the_frame_source_satisfies_its_port(self) -> None:
        assert isinstance(FakeFrameSource(), VideoFrameSource)

    def test_the_audio_source_satisfies_its_port(self) -> None:
        assert isinstance(FakeAudioSource(), AudioSampleSource)

    def test_the_handle_satisfies_its_port(self) -> None:
        assert isinstance(FakeMedia(), DecodedMedia)

    def test_the_decoder_and_prober_satisfy_their_ports(self) -> None:
        assert isinstance(FakeDecoder(), MediaDecoder)
        assert isinstance(FakeProber(), MediaProber)

    def test_the_resampler_satisfies_its_port(self) -> None:
        assert isinstance(NaiveResampler(), AudioResampler)

    def test_subclass_checks_work_because_every_member_is_a_method(self) -> None:
        """Data members would make ``issubclass`` raise ``TypeError``.

        A property on a protocol is invisible to ``isinstance``'s duck check in
        the way a method is not, and a container that registers implementations
        by type wants ``issubclass``.  Keeping every member callable is a
        deliberate constraint on how the port may grow.
        """
        assert issubclass(FakeMedia, DecodedMedia)
        assert issubclass(FakeProber, MediaProber)


class TestNarrowness:
    """Asking for the least you need only means something if more is refused."""

    def test_a_frame_source_is_not_a_whole_file_handle(self) -> None:
        source = FakeFrameSource()
        assert isinstance(source, VideoFrameSource)
        assert not isinstance(source, DecodedMedia)

    def test_a_prober_is_not_a_decoder(self) -> None:
        prober = FakeProber()
        assert isinstance(prober, MediaProber)
        assert not isinstance(prober, MediaDecoder)

    def test_a_video_only_file_still_satisfies_the_handle(self) -> None:
        """Presence of the methods is the contract; emptiness is a return value."""
        assert isinstance(FakeMedia(with_audio=False), DecodedMedia)

    def test_a_partial_double_is_refused(self) -> None:
        class OnlyClose:
            def close(self) -> None: ...

        assert not isinstance(OnlyClose(), VideoFrameSource)
        assert not isinstance(OnlyClose(), DecodedMedia)


class TestRuntimeCheckableLimitations:
    """``runtime_checkable`` checks names, not behaviour.  Pinned, not fixed."""

    def test_a_double_with_the_right_names_and_wrong_behaviour_passes(self) -> None:
        class WrongProber:
            def probe(self, path: str) -> MediaInfo:
                return FakeMedia().info()

        assert isinstance(WrongProber(), MediaProber)

    def test_the_mistake_surfaces_at_the_call_not_at_the_check(self) -> None:
        """The reason the suite exercises the doubles instead of trusting isinstance."""

        class WrongProber:
            def probe(self, path: str) -> MediaInfo:
                return FakeMedia().info()

        result = WrongProber().probe("x.mp4")
        assert not hasattr(result, "is_ok"), "a bare value has no Result protocol"


class TestErrorCodes:
    def test_codes_are_stable_strings(self) -> None:
        assert MediaErrorCode.UNREADABLE == "NS-MEDIA-4001"
        assert MediaErrorCode.UNSUPPORTED == "NS-MEDIA-4003"
        assert MediaErrorCode.DECODE_FAILED == "NS-MEDIA-4004"

    def test_codes_are_unique_and_namespaced(self) -> None:
        values = [code.value for code in MediaErrorCode]
        assert len(values) == len(set(values))
        assert all(value.startswith("NS-MEDIA-") for value in values)

    def test_the_encoder_code_is_left_to_the_render_port(self) -> None:
        """ADR-0007 §7 assigns NS-MEDIA-4002 to a missing encoder."""
        assert "NS-MEDIA-4002" not in [code.value for code in MediaErrorCode]

    def test_a_code_builds_a_structured_error(self) -> None:
        failure = error_result(
            MediaErrorCode.UNSUPPORTED,
            "no decoder for codec prores_ks",
            domain=ErrorDomain.MEDIA,
            details={"codec": "prores_ks"},
            remedy="Switch to the FFmpeg CLI backend.",
        )
        error = failure.unwrap_err()
        assert error.code == "NS-MEDIA-4003"
        assert error.domain is ErrorDomain.MEDIA
        assert error.details["codec"] == "prores_ks"
        assert error.remedy


class TestTheDeclaredFlow:
    """Probe → open → read frames and audio → resample, all through the port."""

    def test_a_probe_returns_a_value_not_an_exception(self) -> None:
        result = FakeProber().probe("/media/clip.mkv")
        assert result.is_ok()
        info = result.unwrap()
        assert info.kind is AssetKind.VIDEO
        assert info.primary_video() is not None
        assert info.primary_video().width == WIDTH

    def test_an_unreadable_file_is_reported_with_a_code(self) -> None:
        result = FakeProber().probe("/media/notes.txt")
        assert result.is_err()
        assert result.unwrap_err().code == MediaErrorCode.UNREADABLE

    def test_opening_a_missing_file_is_reported_with_a_code(self) -> None:
        result = FakeDecoder(fail_with=MediaErrorCode.UNREADABLE).open("/media/gone.mp4")
        assert result.is_err()
        error = result.unwrap_err()
        assert error.code == "NS-MEDIA-4001"
        assert error.remedy

    def test_an_unsupported_codec_names_the_remedy(self) -> None:
        result = FakeDecoder(fail_with=MediaErrorCode.UNSUPPORTED).open("/media/prores.mov")
        assert (
            result.unwrap_err().remedy == "Install the codec or switch to the FFmpeg CLI backend."
        )

    def test_frames_come_out_in_order_and_tagged(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.video()
        assert source is not None
        frames = list(source.frames())
        assert len(frames) == FRAME_COUNT
        assert all(frame.channels == 3 for frame in frames)
        assert all(frame.colour.space is ColourSpace.BT709 for frame in frames)
        # The synthetic frame stores its index in the red channel.
        assert [int(frame.pixels[0, 0, 0]) for frame in frames] == list(range(FRAME_COUNT))

    def test_stop_bounds_the_iteration(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.video()
        assert source is not None
        assert len(list(source.frames(start=2, stop=5))) == 3

    def test_random_access_past_the_end_returns_none_rather_than_raising(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.video()
        assert source is not None
        assert source.frame_at(0) is not None
        assert source.frame_at(FRAME_COUNT) is None
        assert source.frame_at(-1) is None

    def test_iteration_is_lazy(self) -> None:
        """An abandoned iterator must not have decoded the whole stream."""
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.video()
        assert source is not None
        generator = source.frames()
        first = next(generator)
        assert first is not None
        generator.close()

    def test_keyframes_are_where_a_scrubber_can_land(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.video()
        assert source is not None
        assert source.keyframe_indices()[0] == 0
        assert all(0 <= index < FRAME_COUNT for index in source.keyframe_indices())

    def test_audio_arrives_in_blocks_and_never_exceeds_the_request(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        source = media.audio()
        assert source is not None
        blocks = list(source.samples(count=2_500))
        assert [block.frame_count for block in blocks] == [1024, 1024, 452]
        assert all(block.sample_rate == 48_000 for block in blocks)
        assert sum(block.frame_count for block in blocks) == 2_500

    def test_a_file_without_audio_answers_none(self) -> None:
        media = FakeMedia(with_audio=False)
        assert media.audio() is None
        assert media.video() is not None

    def test_closing_the_handle_closes_its_streams_and_is_idempotent(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        video = media.video()
        audio = media.audio()
        media.close()
        media.close()
        assert video is not None and video.closed
        assert audio is not None and audio.closed
        assert media.close_count == 2

    def test_the_resampler_changes_rate_and_channels(self) -> None:
        media = FakeDecoder().open("/media/clip.mkv").unwrap()
        audio = media.audio()
        assert audio is not None
        block = next(iter(audio.samples()))
        resampled = NaiveResampler().resample(block, sample_rate=16_000, channels=1)
        assert resampled.sample_rate == 16_000
        assert resampled.channels == 1
        # The same span of time, resampled: one third as many frames at 16 kHz.
        expected = block.frame_count * 16_000 / block.sample_rate
        assert resampled.frame_count == pytest.approx(expected, abs=2)

    def test_resampling_an_empty_block_is_not_an_error(self) -> None:
        empty = AudioBuffer(samples=np.zeros((0, 2), dtype=np.float32), sample_rate=48_000)
        result = NaiveResampler().resample(empty, sample_rate=48_000, channels=2)
        assert result.is_empty


class TestTheErrorChannel:
    """A failure during reading is latched, not raised out of the iterator."""

    def test_a_clean_read_leaves_no_error(self) -> None:
        source = FakeFrameSource()
        assert len(list(source.frames())) == FRAME_COUNT
        assert source.last_error() is None

    def test_running_past_the_end_is_not_an_error(self) -> None:
        source = FakeFrameSource()
        assert source.frame_at(FRAME_COUNT) is None
        assert source.last_error() is None

    def test_a_damaged_frame_ends_the_iteration_and_latches_the_cause(self) -> None:
        source = FakeFrameSource(fail_at=4)
        frames = list(source.frames())
        assert len(frames) == 4, "every frame before the damage is still usable"
        error = source.last_error()
        assert error is not None
        assert error.code == MediaErrorCode.DECODE_FAILED
        assert error.domain is ErrorDomain.MEDIA
        assert error.details["frame"] == 4

    def test_random_access_to_a_damaged_frame_reports_the_same_way(self) -> None:
        source = FakeFrameSource(fail_at=4)
        assert source.frame_at(4) is None
        assert source.last_error() is not None
        assert source.last_error().code == "NS-MEDIA-4004"

    def test_the_error_clears_when_the_next_read_begins(self) -> None:
        """Latched, not sticky: a retry after a transient failure is meaningful."""
        source = FakeFrameSource(fail_at=4)
        list(source.frames())
        assert source.last_error() is not None
        list(source.frames(stop=2))
        assert source.last_error() is None

    def test_the_same_channel_exists_on_audio(self) -> None:
        media = FakeMedia()
        audio = media.audio()
        assert audio is not None
        list(audio.samples(count=2_048))
        assert audio.last_error() is None


class TestPortPurity:
    """A port that imports an adapter has stopped being a seam."""

    _PATH = pathlib.Path("nova_studio/ports/media.py")

    def _imported_modules(self) -> list[str]:
        import ast

        tree = ast.parse(self._PATH.read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules.append(node.module)
        return modules

    def test_it_imports_no_adapter_library(self) -> None:
        banned = {"av", "cv2", "PIL", "faster_whisper", "imageio_ffmpeg", "subprocess"}
        offenders = [name for name in self._imported_modules() if name.split(".")[0] in banned]
        assert not offenders, f"ports/media.py depends on an adapter: {offenders}"

    def test_it_imports_no_outer_ring(self) -> None:
        offenders = [
            name
            for name in self._imported_modules()
            if name.startswith(("nova_studio.infra", "nova_studio.services", "nova_studio.api"))
        ]
        assert not offenders, f"ports/media.py reaches into an outer ring: {offenders}"

    def test_it_only_names_numpy_through_the_domain(self) -> None:
        """The single sanctioned third-party type is re-exported by ``domain``."""
        assert "numpy" not in self._imported_modules()
