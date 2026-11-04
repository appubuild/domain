"""The render port contract, driven by fakes that behave like an encoder.

The properties pinned here are the ones a happy-path test cannot see and a user
always notices:

* **A render that cannot succeed fails before the first frame.**  A missing
  encoder or an impossible spec is reported by ``open``, not discovered at
  minute forty.
* **``finish`` is the only point at which a file is valid.**  Until it returns
  ``Ok`` the output is incomplete — no index, no duration.
* **``abort`` removes the partial output.**  A half-written file that plays for
  nine seconds is worse than no file, because it looks like success.
* **Cancellation is a value, not a silent stop.**  A cancelled render ends as
  ``Err(CANCELLED)`` so the UI can say "stopped" instead of "failed".

Conformance, narrowness and the ``runtime_checkable`` limitation are pinned as
in the sibling port suites; purity is checked by parsing the port's imports.
Nothing here encodes anything: no FFmpeg, no files, no GPU.
"""

from __future__ import annotations

import pathlib
from typing import Any

import numpy as np
import pytest

from nova_studio.core import ErrorDomain, Timebase, error_result, ok
from nova_studio.domain.export import (
    AudioCodec,
    AudioEncodeSpec,
    ContainerFormat,
    HardwareAccel,
    OutputSpec,
    RateControl,
    RenderStats,
    ToolchainCapabilities,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import AudioBuffer, FrameBuffer
from nova_studio.ports.persistence import PersistenceErrorCode
from nova_studio.ports.render import (
    AudioSink,
    CapabilityProbe,
    FrameSink,
    Renderer,
    RenderErrorCode,
    RenderTarget,
)

pytestmark = pytest.mark.unit

WIDTH, HEIGHT = 32, 18


def _frame(value: int = 0) -> FrameBuffer:
    pixels = np.full((HEIGHT, WIDTH, 3), value, dtype=np.uint8)
    return FrameBuffer(pixels=pixels)


def _audio(frames: int = 480) -> AudioBuffer:
    samples = np.zeros((frames, 2), dtype=np.float32)
    return AudioBuffer(samples=samples, sample_rate=48_000)


def _video_spec(**overrides: Any) -> VideoEncodeSpec:
    defaults: dict[str, Any] = {
        "codec": VideoCodec.H264,
        "width": WIDTH,
        "height": HEIGHT,
        "timebase": Timebase.of(30),
        "rate_control": RateControl.for_crf(20),
    }
    return VideoEncodeSpec(**{**defaults, **overrides})


def _spec(**overrides: Any) -> OutputSpec:
    defaults: dict[str, Any] = {"container": ContainerFormat.MKV, "video": _video_spec()}
    return OutputSpec(**{**defaults, **overrides})


class FakeFrameSink:
    """Counts frames and refuses everything after ``finish`` or ``abort``."""

    def __init__(self, *, cancelled_after: int | None = None) -> None:
        self.frames: list[int] = []
        self.finished = False
        self.aborted = False
        self._cancelled_after = cancelled_after

    def write(self, frame: FrameBuffer) -> Any:
        if self.aborted:
            return error_result(
                RenderErrorCode.CANCELLED, "the sink was aborted", domain=ErrorDomain.RENDER
            )
        if self._cancelled_after is not None and len(self.frames) >= self._cancelled_after:
            return error_result(
                RenderErrorCode.CANCELLED, "the job was cancelled", domain=ErrorDomain.RENDER
            )
        if self.finished:
            return error_result(
                RenderErrorCode.ENCODE_FAILED,
                "the stream is closed",
                domain=ErrorDomain.RENDER,
            )
        self.frames.append(int(frame.pixels[0, 0, 0]))
        return ok(None)

    def finish(self) -> Any:
        self.finished = True
        return ok(RenderStats(frames_written=len(self.frames), bytes_written=1024, elapsed_ms=16))

    def abort(self) -> None:
        self.aborted = True


class FakeAudioSink:
    def __init__(self) -> None:
        self.blocks: list[int] = []
        self.finished = False
        self.aborted = False

    def write(self, buffer: AudioBuffer) -> Any:
        self.blocks.append(buffer.frame_count)
        return ok(None)

    def finish(self) -> Any:
        self.finished = True
        return ok(RenderStats(frames_written=sum(self.blocks), bytes_written=256, elapsed_ms=4))

    def abort(self) -> None:
        self.aborted = True


class FakeRenderTarget:
    """A muxed output that only becomes valid at ``finish``."""

    def __init__(self, *, cancelled_after: int | None = None) -> None:
        self._video = FakeFrameSink(cancelled_after=cancelled_after)
        self._audio: FakeAudioSink | None = None
        self.finished = False
        self.aborted = False
        self.removals = 0

    def video(self) -> FakeFrameSink:
        return self._video

    def audio(self) -> FakeAudioSink | None:
        return self._audio

    def finish(self) -> Any:
        self.finished = True
        return ok(
            RenderStats(
                frames_written=len(self._video.frames),
                bytes_written=1_280,
                elapsed_ms=20,
            )
        )

    def abort(self) -> None:
        """Abandon the render; the partial output is removed once, idempotently."""
        if not self.aborted:
            self.removals += 1
        self.aborted = True
        self._video.abort()
        if self._audio is not None:
            self._audio.abort()


class FakeRenderer:
    """Opens a target, or explains before a single frame is composed why not."""

    def __init__(
        self,
        *,
        capabilities: ToolchainCapabilities | None = None,
        cancelled_after: int | None = None,
    ) -> None:
        self._capabilities = capabilities or ToolchainCapabilities(
            ffmpeg_version="7.0.2",
            encoders=frozenset({"libx264", "h264_nvenc", "aac", "libvpx-vp9"}),
            pixel_formats=frozenset({"yuv420p", "rgb24"}),
            hwaccels=frozenset({"cuda"}),
        )
        self._cancelled_after = cancelled_after
        self.targets: list[FakeRenderTarget] = []

    def open(self, spec: OutputSpec, path: str) -> Any:
        missing = self._capabilities.describe_missing(spec)
        if missing:
            return error_result(
                RenderErrorCode.ENCODER_UNAVAILABLE,
                missing,
                domain=ErrorDomain.MEDIA,
                remedy="Choose another codec or install the missing encoder.",
            )
        if path.endswith("/") or not path:
            return error_result(
                RenderErrorCode.SINK_UNWRITABLE,
                f"{path!r} is not a writable path",
                domain=ErrorDomain.RENDER,
            )
        target = FakeRenderTarget(cancelled_after=self._cancelled_after)
        if spec.audio is not None:
            target._audio = FakeAudioSink()
        self.targets.append(target)
        return ok(target)

    def capabilities(self, *, refresh: bool = False) -> Any:
        return ok(self._capabilities)

    def last_target(self) -> FakeRenderTarget:
        return self.targets[-1]


class TestProtocolConformance:
    def test_each_double_satisfies_its_port(self) -> None:
        assert isinstance(FakeFrameSink(), FrameSink)
        assert isinstance(FakeAudioSink(), AudioSink)
        assert isinstance(FakeRenderTarget(), RenderTarget)
        assert isinstance(FakeRenderer(), Renderer)
        assert isinstance(FakeRenderer(), CapabilityProbe)

    def test_subclass_checks_work_because_every_member_is_a_method(self) -> None:
        assert issubclass(FakeFrameSink, FrameSink)
        assert issubclass(FakeRenderTarget, RenderTarget)
        assert issubclass(FakeRenderer, Renderer)


class TestNarrowness:
    def test_a_frame_sink_is_not_a_whole_target(self) -> None:
        sink = FakeFrameSink()
        assert isinstance(sink, FrameSink)
        assert not isinstance(sink, RenderTarget)

    def test_a_partial_double_is_refused(self) -> None:
        class OnlyFinish:
            def finish(self) -> None: ...

        assert not isinstance(OnlyFinish(), FrameSink)
        assert not isinstance(OnlyFinish(), RenderTarget)


class TestRuntimeCheckableLimitations:
    def test_two_ports_with_the_same_method_names_are_indistinguishable(self) -> None:
        """``FrameSink`` and ``AudioSink`` differ only in their parameter types.

        ``runtime_checkable`` compares names, so a frame sink *is* an audio sink
        as far as ``isinstance`` is concerned.  That is exactly why a consumer
        obtains streams from :class:`RenderTarget` — ``video()`` and ``audio()``
        are separately typed — instead of probing what it was handed.
        """
        sink = FakeFrameSink()
        assert isinstance(sink, FrameSink)
        assert isinstance(sink, AudioSink)

    def test_a_double_with_the_right_names_and_wrong_behaviour_passes(self) -> None:
        class WrongSink:
            def write(self, frame: FrameBuffer) -> None: ...

            def finish(self) -> None: ...

            def abort(self) -> None: ...

        assert isinstance(WrongSink(), FrameSink)

    def test_the_mistake_surfaces_at_the_call_not_at_the_check(self) -> None:
        class WrongSink:
            def write(self, frame: FrameBuffer) -> None: ...

            def finish(self) -> None: ...

            def abort(self) -> None: ...

        assert not hasattr(WrongSink().write(_frame()), "is_ok")


class TestErrorCodes:
    def test_codes_are_stable_strings(self) -> None:
        assert RenderErrorCode.SINK_UNWRITABLE == "NS-RENDER-4001"
        assert RenderErrorCode.ENCODER_UNAVAILABLE == "NS-MEDIA-4002"
        assert RenderErrorCode.ENCODE_FAILED == "NS-RENDER-4003"
        assert RenderErrorCode.UNSUPPORTED_SPEC == "NS-RENDER-4004"
        assert RenderErrorCode.CANCELLED == "NS-RENDER-4005"

    def test_the_encoder_code_is_the_one_adr_0007_promised(self) -> None:
        """ADR-0007 §7: a missing encoder produces NS-MEDIA-4002."""
        from nova_studio.ports.media import MediaErrorCode

        assert RenderErrorCode.ENCODER_UNAVAILABLE == "NS-MEDIA-4002"
        assert "NS-MEDIA-4002" not in {code.value for code in MediaErrorCode}

    def test_render_codes_do_not_collide_with_persistence_codes(self) -> None:
        overlap = {code.value for code in RenderErrorCode} & {
            code.value for code in PersistenceErrorCode
        }
        assert not overlap

    def test_a_missing_encoder_error_carries_the_remedy(self) -> None:
        failure = error_result(
            RenderErrorCode.ENCODER_UNAVAILABLE,
            "this build has no libx265 encoder",
            domain=ErrorDomain.MEDIA,
            details={"encoder": "libx265"},
            remedy="Export H.264 instead.",
        )
        error = failure.unwrap_err()
        assert error.code == "NS-MEDIA-4002"
        assert error.domain is ErrorDomain.MEDIA
        assert error.remedy == "Export H.264 instead."


class TestTheDeclaredFlow:
    def test_a_render_writes_frames_and_reports_stats(self) -> None:
        renderer = FakeRenderer()
        target = renderer.open(_spec(), "/tmp/out.mkv").unwrap()
        sink = target.video()
        for value in range(5):
            assert sink.write(_frame(value)).is_ok()
        stats = sink.finish().unwrap()
        assert stats.frames_written == 5
        assert sink.frames == [0, 1, 2, 3, 4]

    def test_a_file_is_only_valid_after_finish(self) -> None:
        renderer = FakeRenderer()
        target = renderer.open(_spec(), "/tmp/out.mkv").unwrap()
        target.video().write(_frame())
        assert not target.finished
        assert target.finish().is_ok()
        assert target.finished

    def test_writing_after_finish_fails_with_a_code(self) -> None:
        target = FakeRenderTarget()
        target.video().finish()
        result = target.video().write(_frame())
        assert result.unwrap_err().code == RenderErrorCode.ENCODE_FAILED

    def test_audio_is_optional_and_reported_as_absent(self) -> None:
        target = FakeRenderer().open(_spec(), "/tmp/out.mkv").unwrap()
        assert target.audio() is None

    def test_an_output_with_audio_gets_a_second_sink(self) -> None:
        spec = _spec(audio=AudioEncodeSpec(codec=AudioCodec.AAC, sample_rate=48_000, channels=2))
        target = FakeRenderer().open(spec, "/tmp/out.mkv").unwrap()
        audio = target.audio()
        assert audio is not None
        assert audio.write(_audio()).is_ok()
        assert audio.finish().unwrap().frames_written == 480

    def test_abort_removes_the_partial_output_once(self) -> None:
        target = FakeRenderTarget()
        target.abort()
        target.abort()
        assert target.removals == 1
        assert target.video().aborted

    def test_abort_closes_both_streams(self) -> None:
        spec = _spec(audio=AudioEncodeSpec(codec=AudioCodec.AAC, sample_rate=48_000, channels=2))
        target = FakeRenderer().open(spec, "/tmp/out.mkv").unwrap()
        target.abort()
        assert target.video().aborted
        assert target.audio() is not None and target.audio().aborted

    def test_a_cancelled_render_reports_cancelled_not_failed(self) -> None:
        """The user stopped it; that is not the same as it breaking."""
        renderer = FakeRenderer(cancelled_after=2)
        target = renderer.open(_spec(), "/tmp/out.mkv").unwrap()
        sink = target.video()
        assert sink.write(_frame()).is_ok()
        assert sink.write(_frame()).is_ok()
        result = sink.write(_frame())
        assert result.unwrap_err().code == RenderErrorCode.CANCELLED

    def test_a_cancelled_sink_keeps_refusing(self) -> None:
        target = FakeRenderTarget()
        target.abort()
        assert target.video().write(_frame()).unwrap_err().code == RenderErrorCode.CANCELLED

    def test_a_missing_encoder_is_reported_before_the_first_frame(self) -> None:
        renderer = FakeRenderer()
        spec = _spec(video=_video_spec(codec=VideoCodec.HEVC))
        result = renderer.open(spec, "/tmp/out.mkv")
        error = result.unwrap_err()
        assert error.code == "NS-MEDIA-4002"
        assert error.message == "this build has no libx265 encoder"
        assert renderer.targets == []

    def test_a_missing_pixel_format_is_reported_the_same_way(self) -> None:
        renderer = FakeRenderer()
        spec = _spec(video=_video_spec(pixel_format="yuv420p10le"))
        assert renderer.open(spec, "/tmp/out.mkv").unwrap_err().code == "NS-MEDIA-4002"

    def test_unavailable_hardware_is_reported_before_the_first_frame(self) -> None:
        renderer = FakeRenderer(
            capabilities=ToolchainCapabilities(
                encoders=frozenset({"libx264"}),
                pixel_formats=frozenset({"yuv420p"}),
                hwaccels=frozenset({"vdpau"}),
            )
        )
        spec = _spec(video=_video_spec(hardware=HardwareAccel.QSV))
        error = renderer.open(spec, "/tmp/out.mkv").unwrap_err()
        assert error.message == "qsv hardware encoding is not available on this machine"

    def test_hardware_that_exists_is_used(self) -> None:
        renderer = FakeRenderer()
        spec = _spec(video=_video_spec(hardware=HardwareAccel.NVENC))
        assert renderer.open(spec, "/tmp/out.mkv").is_ok()

    def test_an_unwritable_path_is_reported_at_open(self) -> None:
        renderer = FakeRenderer()
        result = renderer.open(_spec(), "/")
        assert result.unwrap_err().code == RenderErrorCode.SINK_UNWRITABLE


class TestTheCapabilityProbe:
    def test_capabilities_describe_the_machine_not_the_hope(self) -> None:
        caps = FakeRenderer().capabilities().unwrap()
        assert caps.supports_encoder("libx264")
        assert not caps.supports_encoder("libx265")
        assert caps.supports_pixel_format("yuv420p")

    def test_refresh_is_a_parameter_not_a_side_effect(self) -> None:
        """Re-probing is explicit user action; the default read is cached."""
        probe = FakeRenderer()
        assert probe.capabilities().unwrap() == probe.capabilities(refresh=True).unwrap()

    def test_a_machine_with_no_toolchain_reports_an_error(self) -> None:
        class NoToolchain:
            def capabilities(self, *, refresh: bool = False) -> Any:
                return error_result(
                    RenderErrorCode.ENCODER_UNAVAILABLE,
                    "no FFmpeg backend is available",
                    domain=ErrorDomain.MEDIA,
                )

        assert isinstance(NoToolchain(), CapabilityProbe)
        result = NoToolchain().capabilities()
        assert result.unwrap_err().message == "no FFmpeg backend is available"


class TestPortPurity:
    """A port that imports an adapter has stopped being a seam."""

    _PATH = pathlib.Path("nova_studio/ports/render.py")

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

    @pytest.mark.parametrize("banned", ["av", "cv2", "subprocess", "pathlib", "pydantic"])
    def test_it_names_no_encoder_library(self, banned: str) -> None:
        offenders = [name for name in self._imported_modules() if name.split(".")[0] == banned]
        assert not offenders, f"ports/render.py names {banned}: {offenders}"

    def test_it_imports_no_outer_ring(self) -> None:
        offenders = [
            name
            for name in self._imported_modules()
            if name.startswith(("nova_studio.infra", "nova_studio.services", "nova_studio.api"))
        ]
        assert not offenders, f"ports/render.py reaches into an outer ring: {offenders}"

    def test_it_speaks_in_domain_types_only(self) -> None:
        assert "nova_studio.domain.export" in self._imported_modules()
        assert "nova_studio.domain.media" in self._imported_modules()
