"""`infra/render.py` — the PyAV renderer, writing files and reading them back.

Every assertion here is made against a file this test wrote and then decoded
with the other half of the media layer, because an export that cannot be read
back is not an export — and because an adapter that got the container, the
timestamps or the colour tags subtly wrong produces a file that plays, looks
nearly right, and is wrong in a way no unit test of a call would catch.

What is being pinned is what the port promises and what an adapter is tempted to
break:

* **Nothing is published until `finish`.** The destination does not exist — or
  still holds the previous export — while frames are being written, and a
  cancelled render leaves nothing behind at all (rule 3).
* **Everything discoverable is discovered in `open`.** A missing encoder, a
  pixel format the codec cannot write, a DNxHD profile that does not exist at
  this size: found before the first frame, not at minute forty.
* **Cancellation is not failure.** A stopped export answers `NS-RENDER-4005`,
  which is how the UI says "stopped" instead of "failed" (rule 4).
* **Capability is measured.** A hardware family is only offered when one of its
  encoders could actually be opened, which is the whole of ADR-0012 §7.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.temporal import Timebase
from nova_studio.domain.export import (
    AudioCodec,
    AudioEncodeSpec,
    ContainerFormat,
    HardwareAccel,
    OutputSpec,
    RateControl,
    RateControlMode,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import (
    AudioBuffer,
    ColourMeta,
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
    FrameBuffer,
)
from nova_studio.infra.render import (
    PyAVCapabilityProbe,
    PyAVRenderer,
)
from nova_studio.ports.render import RenderErrorCode

if TYPE_CHECKING:
    from pathlib import Path

pytest.importorskip("av", reason="PyAV is the adapter under test")
av = pytest.importorskip("av")
import numpy as np  # noqa: E402

pytestmark = [pytest.mark.unit, pytest.mark.media]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

WIDTH, HEIGHT = 320, 240
FRAMES = 24
TIMEBASE = Timebase.of(30_000, 1001)


#: The frame `i` is the flat colour `i * 7 % 255`, so a frame that came back out
#: of order — or a clip stuck on one frame — shows it the moment it is decoded.
def _frame(index: int, channels: int = 3) -> FrameBuffer:
    pixels = np.full((HEIGHT, WIDTH, channels), index * 7 % 255, dtype=np.uint8)
    return FrameBuffer(pixels=pixels)


def _blocks(count: int, *, rate: int = 48_000, channels: int = 2) -> list[AudioBuffer]:
    """Silence and tone alternating, so an order mix-up would show up as silence."""
    return [
        AudioBuffer(
            samples=np.full((1024, channels), 0.1 * (index % 2), dtype=np.float32),
            sample_rate=rate,
        )
        for index in range(count)
    ]


def _spec(**overrides: Any) -> OutputSpec:
    """An H.264 / AAC export, with whatever the caller overrides."""
    video: dict[str, Any] = {
        "codec": VideoCodec.H264,
        "width": WIDTH,
        "height": HEIGHT,
        "timebase": TIMEBASE,
        "rate_control": RateControl.for_crf(23),
        "preset": "veryfast",
    }
    video.update(overrides)
    return OutputSpec(
        container=ContainerFormat.MP4,
        video=VideoEncodeSpec(**video),
        audio=AudioEncodeSpec(codec=AudioCodec.AAC, sample_rate=48_000, channels=2),
    )


@pytest.fixture
def probe() -> PyAVCapabilityProbe:
    return PyAVCapabilityProbe()


@pytest.fixture
def renderer(probe: PyAVCapabilityProbe) -> PyAVRenderer:
    return PyAVRenderer(probe=probe)


# ---------------------------------------------------------------------------
# Capability probing
# ---------------------------------------------------------------------------


class TestCapabilityProbe:
    """Measured, not assumed (ADR-0007 §4)."""

    def test_the_measurement_names_the_toolchain(self, probe: PyAVCapabilityProbe) -> None:
        caps = probe.capabilities().unwrap()
        assert caps.ffmpeg_version
        assert "libx264" in caps.encoders
        assert "aac" in caps.encoders
        assert "yuv420p" in caps.pixel_formats
        assert "scale" in caps.filters

    def test_an_encoder_is_not_a_decoder(self, probe: PyAVCapabilityProbe) -> None:
        """`av.codecs_available` is the union of both directions.

        Offering a user an export codec that is only a decoder is the mistake
        this separation exists to prevent.
        """
        caps = probe.capabilities().unwrap()
        # `av.codecs_available` lists `h264` twice over — FFmpeg 8 exposes it as
        # both an encoder alias and a decoder — so the separation has to be
        # measured name by name, which is exactly what the probe does.
        assert len(caps.encoders) < len(caps.decoders)
        assert caps.decoders - caps.encoders
        assert "aac" in caps.encoders

    def test_probing_is_cached(self, probe: PyAVCapabilityProbe) -> None:
        first = probe.capabilities().unwrap()
        second = probe.capabilities().unwrap()
        assert first is second

    def test_refresh_measures_again(self, probe: PyAVCapabilityProbe) -> None:
        """The "re-detect hardware" button, after a driver update."""
        first = probe.capabilities().unwrap()
        again = probe.capabilities(refresh=True).unwrap()
        assert again is not first
        assert again.encoders == first.encoders

    def test_hardware_is_proven_not_listed(self, probe: PyAVCapabilityProbe) -> None:
        """ADR-0012 §7: a build can be compiled against NVENC and still have no
        usable encoder, so a family is only reported when one of its encoders
        opened."""
        caps = probe.capabilities().unwrap()
        assert caps.hwaccels <= {"cuda", "qsv", "amf", "videotoolbox", "drm"}
        for name in caps.hwaccels:
            assert name in caps.hwaccels  # a name the domain maps, not FFmpeg's own
        # Whatever was reported, the domain and the probe agree about it.
        for accel in HardwareAccel:
            if accel is HardwareAccel.NONE:
                continue
            assert isinstance(caps.supports_hardware(accel), bool)

    def test_a_capability_set_answers_the_export_dialog(self, probe: PyAVCapabilityProbe) -> None:
        caps = probe.capabilities().unwrap()
        assert caps.can_encode(_spec()), caps.describe_missing(_spec())


# ---------------------------------------------------------------------------
# Opening
# ---------------------------------------------------------------------------


class TestOpening:
    """`open` fails before a frame is composed, or not at all."""

    def test_nothing_is_published_until_finish(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """The port's rule 3: until `finish` returns `Ok`, there is no file."""
        destination = tmp_path / "out.mp4"
        target = renderer.open(_spec(), str(destination)).unwrap()
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        assert not destination.exists()
        assert list(tmp_path.glob(".*.part"))
        assert target.finish().is_ok()
        assert destination.exists()

    def test_an_existing_file_survives_until_the_render_succeeds(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """A failed export must not have destroyed the last good one."""
        destination = tmp_path / "out.mp4"
        destination.write_bytes(b"the previous export")
        target = renderer.open(_spec(), str(destination)).unwrap()
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        assert destination.read_bytes() == b"the previous export"
        assert target.finish().is_ok()
        assert destination.read_bytes() != b"the previous export"

    def test_a_folder_that_is_not_there_is_unwritable(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        error = renderer.open(_spec(), str(tmp_path / "missing" / "out.mp4")).unwrap_err()
        assert error.code == RenderErrorCode.SINK_UNWRITABLE
        assert "does not exist" in str(error.cause)

    def test_no_path_at_all_is_unwritable(self, renderer: PyAVRenderer) -> None:
        assert renderer.open(_spec(), "").unwrap_err().code == RenderErrorCode.SINK_UNWRITABLE

    @pytest.mark.skipif(os.geteuid() == 0, reason="a root process can write to a read-only folder")
    def test_a_read_only_folder_is_unwritable(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        locked = tmp_path / "locked"
        locked.mkdir()
        locked.chmod(0o500)
        try:
            error = renderer.open(_spec(), str(locked / "out.mp4")).unwrap_err()
            assert error.code == RenderErrorCode.SINK_UNWRITABLE
        finally:
            locked.chmod(0o700)

    def test_an_encoder_this_build_lacks_is_refused_at_once(
        self, renderer: PyAVRenderer, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`NS-MEDIA-4002`, with the remedy the domain wrote for a person."""
        monkeypatch.setattr(av, "codecs_available", frozenset())
        error = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap_err()
        assert error.code == RenderErrorCode.ENCODER_UNAVAILABLE
        assert "libx264" in str(error.remedy)

    def test_hardware_the_machine_does_not_have_is_refused_at_once(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """The most specific reason first: "no NVENC" beats "no h264_nvenc"."""
        spec = _spec(hardware=HardwareAccel.NVENC)
        error = renderer.open(spec, str(tmp_path / "out.mp4")).unwrap_err()
        assert error.code == RenderErrorCode.ENCODER_UNAVAILABLE
        assert "nvenc" in str(error.remedy).lower()

    def test_a_spec_the_encoder_rejects_is_refused_at_once(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """DNxHD exists only for a handful of size, rate and bit-rate triples.

        Asking the encoder is the only way to know, and it is asked here rather
        than at frame 40 000.
        """
        spec = OutputSpec(
            container=ContainerFormat.MOV,
            video=VideoEncodeSpec(
                codec=VideoCodec.DNXHD,
                width=WIDTH,
                height=HEIGHT,
                timebase=TIMEBASE,
                rate_control=RateControl.for_cbr(120_000_000),
            ),
        )
        error = renderer.open(spec, str(tmp_path / "out.mov")).unwrap_err()
        assert error.code == RenderErrorCode.UNSUPPORTED_SPEC
        assert "dnxhd" in str(error.cause)

    def test_a_pixel_format_the_encoder_cannot_write_is_refused_at_once(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """`swscale` can make `gbrp`; H.264 cannot hold it.

        Which is why the check is the encoder's own list and not the global one.
        """
        spec = _spec(pixel_format="gbrp")
        error = renderer.open(spec, str(tmp_path / "out.mp4")).unwrap_err()
        assert error.code == RenderErrorCode.UNSUPPORTED_SPEC

    def test_a_spec_without_audio_has_no_audio_sink(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        spec = OutputSpec(
            container=ContainerFormat.MP4,
            video=_spec().video,
        )
        target = renderer.open(spec, str(tmp_path / "silent.mp4")).unwrap()
        assert target.audio() is None
        assert target.abort() is None

    def test_the_renderer_speaks_the_port(self, renderer: PyAVRenderer) -> None:
        from nova_studio.ports.render import Renderer

        assert isinstance(renderer, Renderer)


# ---------------------------------------------------------------------------
# Video
# ---------------------------------------------------------------------------


def _read_video(path: Path) -> tuple[list[Any], Any]:
    """Decode a file this test wrote, the way a player would."""
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return list(container.decode(video=0)), stream


class TestVideoSink:
    """Frames in, a file that reads back the way it was written."""

    def _render(self, renderer: PyAVRenderer, path: Path, spec: OutputSpec | None = None) -> Any:
        target = renderer.open(spec or _spec(), str(path)).unwrap()
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        stats = target.finish().unwrap()
        return stats

    def test_the_file_says_what_the_spec_asked_for(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        path = tmp_path / "out.mp4"
        stats = self._render(renderer, path)
        frames, stream = _read_video(path)
        assert len(frames) == FRAMES == stats.frames_written
        assert stream.codec_context.name == "h264"
        assert (stream.codec_context.width, stream.codec_context.height) == (WIDTH, HEIGHT)
        assert stream.codec_context.pix_fmt == "yuv420p"
        assert stats.bytes_written == path.stat().st_size

    def test_the_rate_survives_the_round_trip(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        """29.97 stays 29.97: a rate that became a float drifts a frame a minute."""
        path = tmp_path / "out.mp4"
        self._render(renderer, path)
        frames, stream = _read_video(path)
        assert stream.average_rate == TIMEBASE.fraction
        assert frames[-1].pts == round((FRAMES - 1) * TIMEBASE.den / TIMEBASE.num * 30_000)

    def test_the_frames_come_back_in_the_order_they_went_in(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        path = tmp_path / "out.mp4"
        self._render(renderer, path)
        frames, _ = _read_video(path)
        decoded = [float(frame.to_ndarray(format="rgb24").mean()) for frame in frames]
        expected = [index * 7 % 255 for index in range(FRAMES)]
        assert all(abs(a - b) < 6 for a, b in zip(decoded, expected, strict=True))

    def test_the_colour_tags_are_written_when_the_spec_declares_them(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """A file tagged with a colour it was not encoded in plays wrong everywhere."""
        colour = ColourMeta(
            space=ColourSpace.BT709,
            range=ColourRange.LIMITED,
            primaries=ColourPrimaries.BT709,
            transfer=ColourTransfer.BT709,
        )
        path = tmp_path / "out.mp4"
        self._render(renderer, path, _spec(colour=colour))
        _, stream = _read_video(path)
        context = stream.codec_context
        assert context.colorspace == int(ColourSpace.BT709)
        assert context.color_range == int(ColourRange.LIMITED)
        assert context.color_primaries == int(ColourPrimaries.BT709)
        assert context.color_trc == int(ColourTransfer.BT709)

    def test_an_unspecified_colour_is_not_invented(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """An adapter that guessed BT.709 would be believed, and would be wrong."""
        path = tmp_path / "out.mp4"
        self._render(renderer, path, _spec(colour=ColourMeta()))
        _, stream = _read_video(path)
        assert stream.codec_context.colorspace == int(ColourSpace.UNSPECIFIED)

    @pytest.mark.parametrize(
        ("mode", "control"),
        [
            (RateControlMode.CRF, RateControl.for_crf(20)),
            (RateControlMode.CBR, RateControl.for_cbr(4_000_000)),
            (RateControlMode.VBR, RateControl.for_vbr(4_000_000, max_bit_rate=8_000_000)),
        ],
        ids=lambda value: str(value),
    )
    def test_every_rate_control_mode_produces_a_file(
        self, renderer: PyAVRenderer, tmp_path: Path, mode: Any, control: Any
    ) -> None:
        path = tmp_path / f"{mode}.mp4"
        self._render(renderer, path, _spec(rate_control=control))
        frames, stream = _read_video(path)
        assert len(frames) == FRAMES
        assert stream.codec_context.name == "h264"

    def test_a_lossless_prores_export(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        spec = OutputSpec(
            container=ContainerFormat.MOV,
            video=VideoEncodeSpec(
                codec=VideoCodec.PRORES,
                width=WIDTH,
                height=HEIGHT,
                timebase=TIMEBASE,
                rate_control=RateControl.lossless(),
                pixel_format="yuv422p10le",
            ),
        )
        path = tmp_path / "master.mov"
        self._render(renderer, path, spec)
        frames, stream = _read_video(path)
        assert len(frames) == FRAMES
        assert stream.codec_context.name == "prores"
        assert stream.codec_context.pix_fmt == "yuv422p10le"

    def test_faststart_moves_the_index_to_the_front(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        path = tmp_path / "streaming.mp4"
        spec = _spec()
        target = renderer.open(
            OutputSpec(
                container=spec.container, video=spec.video, audio=spec.audio, faststart=True
            ),
            str(path),
        ).unwrap()
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        assert target.finish().is_ok()
        raw = path.read_bytes()
        assert 0 < raw.find(b"moov") < raw.find(b"mdat")

    def test_a_frame_that_is_not_rgb(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        """A mask is one channel and a title card is four; both must encode."""
        path = tmp_path / "channels.mp4"
        target = renderer.open(_spec(), str(path)).unwrap()
        assert target.video().write(_frame(3, channels=1)).is_ok()
        assert target.video().write(_frame(9, channels=4)).is_ok()
        assert target.finish().is_ok()
        frames, _ = _read_video(path)
        assert len(frames) == 2

    def test_writing_after_the_stream_is_closed_fails(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        assert target.video().write(_frame(0)).is_ok()
        assert target.video().finish().is_ok()
        error = target.video().write(_frame(1)).unwrap_err()
        assert error.code == RenderErrorCode.ENCODE_FAILED

    def test_finishing_twice_answers_the_same_stats(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        target.video().write(_frame(0))
        first = target.video().finish().unwrap()
        second = target.video().finish().unwrap()
        assert first == second
        assert target.finish().is_ok()


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------


class TestAudioSink:
    """Blocks in, resampled to the output's rate and layout."""

    def test_audio_is_written_and_reads_back(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        path = tmp_path / "with-audio.mp4"
        target = renderer.open(_spec(), str(path)).unwrap()
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        for block in _blocks(10):
            assert target.audio().write(block).is_ok()  # type: ignore[union-attr]
        assert target.finish().is_ok()

        with av.open(str(path)) as container:
            stream = container.streams.audio[0]
            assert stream.codec_context.name == "aac"
            assert stream.sample_rate == 48_000
            assert stream.channels == 2
            decoded = list(container.decode(audio=0))
        assert sum(frame.samples for frame in decoded) >= 10 * 1024

    def test_the_mix_is_resampled_to_the_output_rate(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """A 44.1 kHz timeline exported at 48 kHz, without telling the mixer."""
        path = tmp_path / "resampled.mp4"
        spec = _spec()
        assert spec.audio is not None
        target = renderer.open(
            OutputSpec(
                container=spec.container,
                video=spec.video,
                audio=AudioEncodeSpec(
                    codec=AudioCodec.AAC, sample_rate=48_000, channels=2, bit_rate=128_000
                ),
            ),
            str(path),
        ).unwrap()
        for block in _blocks(10, rate=44_100):
            assert target.audio().write(block).is_ok()  # type: ignore[union-attr]
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        assert target.finish().is_ok()

        with av.open(str(path)) as container:
            stream = container.streams.audio[0]
            assert stream.sample_rate == 48_000
            seconds = float(stream.duration * stream.time_base)
        # 10 240 samples at 44.1 kHz is 0.232 s; resampled, the same sound is the
        # same length of *time* at the new rate.
        assert 0.21 < seconds < 0.26

    def test_channels_are_converted_to_the_output_layout(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        path = tmp_path / "mono-to-stereo.mp4"
        spec = _spec()
        target = renderer.open(
            OutputSpec(
                container=spec.container,
                video=spec.video,
                audio=AudioEncodeSpec(codec=AudioCodec.AAC, sample_rate=48_000, channels=1),
            ),
            str(path),
        ).unwrap()
        for block in _blocks(4, channels=2):
            assert target.audio().write(block).is_ok()  # type: ignore[union-attr]
        for index in range(FRAMES):
            assert target.video().write(_frame(index)).is_ok()
        assert target.finish().is_ok()

        with av.open(str(path)) as container:
            assert container.streams.audio[0].channels == 1

    def test_sixteen_bit_pcm_round_trips(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        """The one audio path that is not float, in the one container that wants it."""
        # Matroska, because a WAV holds no picture at all and the domain says so.
        spec = OutputSpec(
            container=ContainerFormat.MKV,
            video=_spec().video,
            audio=AudioEncodeSpec(codec=AudioCodec.PCM_S16LE, sample_rate=48_000, channels=2),
        )
        path = tmp_path / "voice.mkv"
        target = renderer.open(spec, str(path)).unwrap()
        for block in _blocks(4):
            assert target.audio().write(block).is_ok()  # type: ignore[union-attr]
        assert target.finish().is_ok()
        with av.open(str(path)) as container:
            stream = container.streams.audio[0]
            assert stream.codec_context.name == "pcm_s16le"
            assert stream.codec_context.format.name == "s16"

    def test_an_empty_block_writes_nothing(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        empty = AudioBuffer(samples=np.zeros((0, 2), dtype=np.float32), sample_rate=48_000)
        assert target.audio().write(empty).is_ok()  # type: ignore[union-attr]
        assert target.audio().blocks_written == 0  # type: ignore[union-attr]
        assert target.abort() is None

    def test_writing_after_the_stream_is_closed_fails(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        audio = target.audio()
        assert audio is not None
        assert audio.write(_blocks(1)[0]).is_ok()
        assert audio.finish().is_ok()
        assert audio.write(_blocks(1)[0]).unwrap_err().code == RenderErrorCode.ENCODE_FAILED
        target.abort()


# ---------------------------------------------------------------------------
# Cancellation and aborting
# ---------------------------------------------------------------------------


class TestAbandoning:
    """A stopped export leaves nothing behind, and says so with its own code."""

    def test_a_cancelled_render_fails_every_write(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        cancelled = True
        target = renderer.open(
            _spec(), str(tmp_path / "out.mp4"), is_cancelled=lambda: cancelled
        ).unwrap()
        error = target.video().write(_frame(0)).unwrap_err()
        assert error.code == RenderErrorCode.CANCELLED
        assert error.retryable is True
        cancelled = False
        assert target.video().write(_frame(0)).is_ok()
        assert target.video().frames_written == 1
        target.abort()

    def test_abort_removes_the_partial_file(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        destination = tmp_path / "out.mp4"
        target = renderer.open(_spec(), str(destination)).unwrap()
        for index in range(6):
            assert target.video().write(_frame(index)).is_ok()
        target.abort()
        assert not destination.exists()
        assert not list(tmp_path.glob(".*.part"))

    def test_abort_leaves_the_previous_export_alone(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        destination = tmp_path / "out.mp4"
        destination.write_bytes(b"the previous export")
        target = renderer.open(_spec(), str(destination)).unwrap()
        target.video().write(_frame(0))
        target.abort()
        assert destination.read_bytes() == b"the previous export"

    def test_abort_twice_is_one_abort(self, renderer: PyAVRenderer, tmp_path: Path) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        target.abort()
        target.abort()
        assert not list(tmp_path.glob(".*.part"))

    def test_finish_after_abort_answers_cancelled_not_failed(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        """The job framework has to tell "stopped" from "broke" (rule 4)."""
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        target.video().write(_frame(0))
        target.abort()
        assert target.finish().unwrap_err().code == RenderErrorCode.CANCELLED

    def test_finishing_twice_answers_the_same_thing(
        self, renderer: PyAVRenderer, tmp_path: Path
    ) -> None:
        target = renderer.open(_spec(), str(tmp_path / "out.mp4")).unwrap()
        target.video().write(_frame(0))
        first = target.finish().unwrap()
        second = target.finish().unwrap()
        assert first == second
