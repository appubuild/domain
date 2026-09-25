"""L2 — export: what the user asked the renderer to produce, and what the
toolchain can actually do.

Two halves, deliberately in one module because they are two sides of the same
question — "can I export this?":

**Render intent.**  :class:`OutputSpec` and its parts describe *what* should be
written: container, video codec, geometry, rate control, colour, audio.  Every
field is plain data with a canonical JSON form, because export presets are
stored (ADR-0015 ``templates/``), export history is listed, and a support
engineer needs to read a preset the user attached to a bug report.

**Toolchain capability.**  :class:`ToolchainCapabilities` is what probing
measured.  ADR-0007 §4 is explicit: *no feature may assume an encoder exists*.
The measured facts behind the defaults in this module come from the bundled
FFmpeg 7.0.2 static build (imageio-ffmpeg 0.6.0) on 2026-09-25:

* video encoders: ``libx264``, ``libx264rgb``, ``libx265``, ``libvpx-vp9``,
  ``libaom-av1``, ``prores``/``prores_aw``/``prores_ks``, ``mpeg4``,
  ``libxvid``, ``dnxhd``
* audio encoders: ``aac``, ``libmp3lame``, ``libopus``, ``flac``,
  ``pcm_s16le``, ``libvorbis``, ``ac3``, ``eac3``
* containers: ``mp4``, ``mov``, ``matroska``, ``webm``, ``wav``, ``mp3``, ``mxf``
* pixel formats: ``yuv420p``, ``yuv422p``, ``yuv444p``, ``yuv420p10le``,
  ``yuv422p10le``, ``yuv444p10le``, ``nv12``, ``p010le``, ``rgb24``, ``rgba``,
  ``gbrp``, ``gray``

The same probe on this machine reports exactly one hardware acceleration
method — ``vdpau`` — which is the whole argument for probing instead of
assuming: a machine with an NVIDIA card will report ``nvenc``, and a build that
ships without ``libx265`` must say so to the user rather than at minute forty
of an export (ADR-0007: ``Err(NS-MEDIA-4002)`` with a human-readable remedy).

Invariants here are the ones that would otherwise be discovered by an encoder
failing halfway through a two-hour render: odd dimensions with 4:2:0 chroma, a
codec the container cannot hold, a CRF value outside the codec's range, a
hardware encoder requested for a codec that has none.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import ColourMeta

__all__ = [
    "AudioCodec",
    "AudioEncodeSpec",
    "ContainerFormat",
    "HardwareAccel",
    "OutputSpec",
    "RateControl",
    "RateControlMode",
    "RenderStats",
    "ToolchainCapabilities",
    "VideoCodec",
    "VideoEncodeSpec",
]


class VideoCodec(StrEnum):
    """Video codecs Nova Studio can write, as *codec* names rather than encoder
    names.

    The distinction matters: ``h264`` is what the user chooses, ``libx264`` and
    ``h264_nvenc`` are two different things that can produce it.  Keeping the
    user's choice separate from the encoder that implements it is what lets the
    same preset export on a machine with and without a GPU.
    """

    H264 = "h264"
    HEVC = "hevc"
    VP9 = "vp9"
    AV1 = "av1"
    PRORES = "prores"
    MPEG4 = "mpeg4"
    DNXHD = "dnxhd"


class AudioCodec(StrEnum):
    """Audio codecs Nova Studio can write."""

    AAC = "aac"
    MP3 = "mp3"
    OPUS = "opus"
    FLAC = "flac"
    PCM_S16LE = "pcm_s16le"
    VORBIS = "vorbis"
    AC3 = "ac3"


class ContainerFormat(StrEnum):
    """Container formats Nova Studio can write.

    The *muxer* name differs from the user-facing name for Matroska
    (``matroska`` in FFmpeg, ``.mkv`` everywhere else), so the mapping lives
    here rather than in an adapter.
    """

    MP4 = "mp4"
    MOV = "mov"
    MKV = "mkv"
    WEBM = "webm"
    WAV = "wav"
    MP3 = "mp3"
    MXF = "mxf"

    def accepts_video(self, codec: VideoCodec) -> bool:
        """Whether this container can carry ``codec``.

        Not every codec fits every container: WebM holds VP9 and AV1, a WAV
        file holds no picture at all.  Checking here is what turns an
        impossible export into a message at the dialog instead of an encoder
        error at frame 40 000.
        """
        return codec in CONTAINER_VIDEO_CODECS[self]

    def accepts_audio(self, codec: AudioCodec) -> bool:
        """Whether this container can carry ``codec``."""
        return codec in CONTAINER_AUDIO_CODECS[self]


class HardwareAccel(StrEnum):
    """Hardware encoder families, negotiated separately from compositing.

    ADR-0012 §7: a machine may support hardware *decode* and have no usable
    encode path, so this is a request that capability probing must answer, not a
    switch that is silently honoured.
    """

    NONE = "none"
    NVENC = "nvenc"
    QSV = "qsv"
    AMF = "amf"
    VIDEOTOOLBOX = "videotoolbox"


class RateControlMode(StrEnum):
    """How a codec decides how many bits a frame gets."""

    #: Constant quality: one number, best for archival and for most exports.
    CRF = "crf"
    #: Constant bitrate: required by some broadcast and streaming specs.
    CBR = "cbr"
    #: Variable bitrate targeting an average, capped by a maximum.
    VBR = "vbr"
    #: Mathematically lossless (ProRes, FLAC, FFV1-style codecs).
    LOSSLESS = "lossless"


#: Codec → software encoder, as measured on the bundled FFmpeg 7.0.2.
SOFTWARE_ENCODERS: Final[dict[VideoCodec, str]] = {
    VideoCodec.H264: "libx264",
    VideoCodec.HEVC: "libx265",
    VideoCodec.VP9: "libvpx-vp9",
    VideoCodec.AV1: "libaom-av1",
    VideoCodec.PRORES: "prores_ks",
    VideoCodec.MPEG4: "mpeg4",
    VideoCodec.DNXHD: "dnxhd",
}

#: Codec → audio encoder, as measured on the bundled FFmpeg 7.0.2.
SOFTWARE_AUDIO_ENCODERS: Final[dict[AudioCodec, str]] = {
    AudioCodec.AAC: "aac",
    AudioCodec.MP3: "libmp3lame",
    AudioCodec.OPUS: "libopus",
    AudioCodec.FLAC: "flac",
    AudioCodec.PCM_S16LE: "pcm_s16le",
    AudioCodec.VORBIS: "libvorbis",
    AudioCodec.AC3: "ac3",
}

#: (codec, hardware family) → hardware encoder name.  Empty means the family has
#: no encoder for that codec, which is a capability answer, not an error.
HARDWARE_ENCODERS: Final[dict[tuple[VideoCodec, HardwareAccel], str]] = {
    (VideoCodec.H264, HardwareAccel.NVENC): "h264_nvenc",
    (VideoCodec.HEVC, HardwareAccel.NVENC): "hevc_nvenc",
    (VideoCodec.AV1, HardwareAccel.NVENC): "av1_nvenc",
    (VideoCodec.H264, HardwareAccel.QSV): "h264_qsv",
    (VideoCodec.HEVC, HardwareAccel.QSV): "hevc_qsv",
    (VideoCodec.H264, HardwareAccel.AMF): "h264_amf",
    (VideoCodec.HEVC, HardwareAccel.AMF): "hevc_amf",
    (VideoCodec.H264, HardwareAccel.VIDEOTOOLBOX): "h264_videotoolbox",
    (VideoCodec.HEVC, HardwareAccel.VIDEOTOOLBOX): "hevc_videotoolbox",
}

#: Container → muxer name in FFmpeg.
MUXERS: Final[dict[ContainerFormat, str]] = {
    ContainerFormat.MP4: "mp4",
    ContainerFormat.MOV: "mov",
    ContainerFormat.MKV: "matroska",
    ContainerFormat.WEBM: "webm",
    ContainerFormat.WAV: "wav",
    ContainerFormat.MP3: "mp3",
    ContainerFormat.MXF: "mxf",
}

#: Container → video codecs it can carry.
CONTAINER_VIDEO_CODECS: Final[dict[ContainerFormat, frozenset[VideoCodec]]] = {
    ContainerFormat.MP4: frozenset(
        {VideoCodec.H264, VideoCodec.HEVC, VideoCodec.AV1, VideoCodec.MPEG4}
    ),
    ContainerFormat.MOV: frozenset(
        {
            VideoCodec.H264,
            VideoCodec.HEVC,
            VideoCodec.AV1,
            VideoCodec.PRORES,
            VideoCodec.MPEG4,
            VideoCodec.DNXHD,
        }
    ),
    ContainerFormat.MKV: frozenset(VideoCodec),
    ContainerFormat.WEBM: frozenset({VideoCodec.VP9, VideoCodec.AV1}),
    ContainerFormat.WAV: frozenset(),
    ContainerFormat.MP3: frozenset(),
    ContainerFormat.MXF: frozenset({VideoCodec.DNXHD, VideoCodec.H264, VideoCodec.MPEG4}),
}

#: Container → audio codecs it can carry.
CONTAINER_AUDIO_CODECS: Final[dict[ContainerFormat, frozenset[AudioCodec]]] = {
    ContainerFormat.MP4: frozenset(
        {AudioCodec.AAC, AudioCodec.AC3, AudioCodec.FLAC, AudioCodec.MP3}
    ),
    ContainerFormat.MOV: frozenset(
        {
            AudioCodec.AAC,
            AudioCodec.AC3,
            AudioCodec.FLAC,
            AudioCodec.MP3,
            AudioCodec.PCM_S16LE,
        }
    ),
    ContainerFormat.MKV: frozenset(AudioCodec),
    ContainerFormat.WEBM: frozenset({AudioCodec.OPUS, AudioCodec.VORBIS}),
    ContainerFormat.WAV: frozenset({AudioCodec.PCM_S16LE}),
    ContainerFormat.MP3: frozenset({AudioCodec.MP3}),
    ContainerFormat.MXF: frozenset({AudioCodec.PCM_S16LE}),
}

#: Pixel formats with 4:2:0 chroma subsampling: both dimensions must be even,
#: because a half-pixel of chroma cannot be stored.
_PLANAR_420: Final[frozenset[str]] = frozenset({"yuv420p", "yuv420p10le", "nv12", "p010le"})
#: 4:2:2 subsamples horizontally only: the width must be even.
_PLANAR_422: Final[frozenset[str]] = frozenset({"yuv422p", "yuv422p10le"})

#: Codecs whose encoders take a CRF-style quality number, and its range.
_CRF_RANGES: Final[dict[VideoCodec, tuple[int, int]]] = {
    VideoCodec.H264: (0, 51),
    VideoCodec.HEVC: (0, 51),
    VideoCodec.VP9: (0, 63),
    VideoCodec.AV1: (0, 63),
    VideoCodec.MPEG4: (1, 31),
}


@dataclass(frozen=True, slots=True)
class RateControl:
    """How many bits the encoder is allowed to spend.

    One object rather than a pile of optional integers, because "CRF 20 and
    bitrate 5 Mbit/s" is not a spec — it is two contradictory instructions, and
    the encoder picking one silently is how an export comes out at the wrong
    size.
    """

    mode: RateControlMode
    crf: int | None = None
    bit_rate: int | None = None
    max_bit_rate: int | None = None

    def __post_init__(self) -> None:
        if self.mode is RateControlMode.CRF:
            if self.crf is None:
                raise NovaInvariantError("CRF mode requires a crf value")
            if not 0 <= self.crf <= 63:
                raise NovaInvariantError(f"crf must be between 0 and 63, got {self.crf}")
            if self.bit_rate is not None:
                raise NovaInvariantError("CRF mode must not also set a bit rate")
        elif self.mode is RateControlMode.CBR:
            if not self.bit_rate or self.bit_rate <= 0:
                raise NovaInvariantError(
                    f"CBR mode requires a positive bit_rate, got {self.bit_rate}"
                )
            if self.crf is not None:
                raise NovaInvariantError("CBR mode must not also set a crf value")
        elif self.mode is RateControlMode.VBR:
            if not self.bit_rate or self.bit_rate <= 0:
                raise NovaInvariantError(
                    f"VBR mode requires a positive bit_rate, got {self.bit_rate}"
                )
            if self.max_bit_rate is not None and self.max_bit_rate < self.bit_rate:
                raise NovaInvariantError(
                    f"max_bit_rate ({self.max_bit_rate}) must not be below the "
                    f"target bit rate ({self.bit_rate})"
                )
        elif self.crf is not None or self.bit_rate is not None:
            raise NovaInvariantError("lossless mode takes neither crf nor bit rate")

    @classmethod
    def for_crf(cls, value: int) -> RateControl:
        """Constant quality — the sensible default for most exports."""
        return cls(mode=RateControlMode.CRF, crf=value)

    @classmethod
    def for_cbr(cls, bit_rate: int) -> RateControl:
        """Constant bitrate, for the delivery specs that demand it."""
        return cls(mode=RateControlMode.CBR, bit_rate=bit_rate)

    @classmethod
    def for_vbr(cls, bit_rate: int, *, max_bit_rate: int | None = None) -> RateControl:
        """Variable bitrate targeting ``bit_rate``, optionally capped."""
        return cls(mode=RateControlMode.VBR, bit_rate=bit_rate, max_bit_rate=max_bit_rate)

    @classmethod
    def lossless(cls) -> RateControl:
        """Lossless, for intermediate and archival codecs."""
        return cls(mode=RateControlMode.LOSSLESS)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "mode": str(self.mode),
            "crf": self.crf,
            "bit_rate": self.bit_rate,
            "max_bit_rate": self.max_bit_rate,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> RateControl:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _RATE_CONTROL_FIELDS)
        raw_mode = _wire_str(data, "mode")
        try:
            mode = RateControlMode(raw_mode)
        except ValueError as error:
            raise NovaInvariantError(f"unknown rate control mode {raw_mode!r}") from error
        return cls(
            mode=mode,
            crf=_optional_int(data, "crf"),
            bit_rate=_optional_int(data, "bit_rate"),
            max_bit_rate=_optional_int(data, "max_bit_rate"),
        )


@dataclass(frozen=True, slots=True)
class VideoEncodeSpec:
    """Everything an encoder needs to know before the first frame arrives."""

    codec: VideoCodec
    width: int
    height: int
    timebase: Timebase
    rate_control: RateControl
    pixel_format: str = "yuv420p"
    colour: ColourMeta = field(default_factory=ColourMeta)
    gop_size: int = 0
    preset: str = ""
    hardware: HardwareAccel = HardwareAccel.NONE

    def __post_init__(self) -> None:
        if self.width < 2 or self.height < 2:
            raise NovaInvariantError(
                f"output dimensions must be at least 2x2, got {self.width}x{self.height}"
            )
        if self.pixel_format in _PLANAR_420 and (self.width % 2 or self.height % 2):
            raise NovaInvariantError(
                f"{self.pixel_format} requires even dimensions, got {self.width}x{self.height}"
            )
        if self.pixel_format in _PLANAR_422 and self.width % 2:
            raise NovaInvariantError(
                f"{self.pixel_format} requires an even width, got {self.width}"
            )
        if self.gop_size < 0:
            raise NovaInvariantError(f"gop_size must not be negative, got {self.gop_size}")
        self._check_rate_control()

    def _check_rate_control(self) -> None:
        control = self.rate_control
        if control.mode is RateControlMode.CRF:
            allowed = _CRF_RANGES.get(self.codec)
            if allowed is None:
                raise NovaInvariantError(
                    f"{self.codec} has no constant-quality mode; use lossless or a bit rate"
                )
            low, high = allowed
            if control.crf is None or not low <= control.crf <= high:
                raise NovaInvariantError(
                    f"crf for {self.codec} must be between {low} and {high}, got {control.crf}"
                )
        if control.mode is RateControlMode.LOSSLESS and self.codec not in (
            VideoCodec.PRORES,
            VideoCodec.DNXHD,
        ):
            raise NovaInvariantError(f"{self.codec} has no lossless mode")

    @property
    def encoder_name(self) -> str:
        """The FFmpeg encoder this spec resolves to.

        Hardware first when it was requested and exists for the codec, otherwise
        the measured software encoder.  Whether the encoder is *present* is a
        capability question, not a property of this object —
        :meth:`ToolchainCapabilities.can_encode` answers it.
        """
        if self.hardware is not HardwareAccel.NONE:
            accelerated = HARDWARE_ENCODERS.get((self.codec, self.hardware))
            if accelerated is not None:
                return accelerated
        return SOFTWARE_ENCODERS[self.codec]

    @property
    def bit_depth(self) -> int:
        """Bits per sample, read from the pixel format name."""
        return 10 if self.pixel_format.endswith(("10le", "10be")) else 8

    @property
    def frame_rate(self) -> float:
        """Frames per second."""
        return self.timebase.fps

    @property
    def is_intermediate(self) -> bool:
        """True for mezzanine codecs (ProRes, DNxHD) meant for further editing."""
        return self.codec in (VideoCodec.PRORES, VideoCodec.DNXHD)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "codec": str(self.codec),
            "width": self.width,
            "height": self.height,
            "timebase": self.timebase.to_dict(),
            "rate_control": self.rate_control.to_wire(),
            "pixel_format": self.pixel_format,
            "colour": self.colour.to_wire(),
            "gop_size": self.gop_size,
            "preset": self.preset,
            "hardware": str(self.hardware),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> VideoEncodeSpec:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _VIDEO_SPEC_FIELDS)
        raw_codec = _wire_str(data, "codec")
        raw_hardware = _wire_str(data, "hardware")
        raw_timebase = data["timebase"]
        raw_control = data["rate_control"]
        raw_colour = data["colour"]
        if not isinstance(raw_timebase, Mapping):
            raise NovaInvariantError("timebase must be a mapping of num/den")
        if not isinstance(raw_control, Mapping):
            raise NovaInvariantError("rate_control must be a mapping")
        if not isinstance(raw_colour, Mapping):
            raise NovaInvariantError("colour must be a mapping")
        try:
            codec = VideoCodec(raw_codec)
            hardware = HardwareAccel(raw_hardware)
        except ValueError as error:
            raise NovaInvariantError(f"unknown encode value: {error}") from error
        return cls(
            codec=codec,
            width=_wire_int(data, "width"),
            height=_wire_int(data, "height"),
            timebase=Timebase.from_dict(_wire_int_mapping(raw_timebase, "timebase")),
            rate_control=RateControl.from_wire(raw_control),
            pixel_format=_wire_str(data, "pixel_format"),
            colour=ColourMeta.from_wire(raw_colour),
            gop_size=_wire_int(data, "gop_size"),
            preset=_wire_str(data, "preset"),
            hardware=hardware,
        )


@dataclass(frozen=True, slots=True)
class AudioEncodeSpec:
    """Everything an audio encoder needs to know."""

    codec: AudioCodec
    sample_rate: int
    channels: int
    bit_rate: int = 0

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise NovaInvariantError(f"sample_rate must be positive, got {self.sample_rate}")
        if self.channels <= 0:
            raise NovaInvariantError(f"channels must be positive, got {self.channels}")
        if self.bit_rate < 0:
            raise NovaInvariantError(f"bit_rate must not be negative, got {self.bit_rate}")
        if self.codec is AudioCodec.PCM_S16LE and self.bit_rate:
            raise NovaInvariantError("PCM has no bit rate: it is defined by rate and depth")

    @property
    def encoder_name(self) -> str:
        """The FFmpeg encoder this spec resolves to."""
        return SOFTWARE_AUDIO_ENCODERS[self.codec]

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "codec": str(self.codec),
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "bit_rate": self.bit_rate,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> AudioEncodeSpec:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _AUDIO_SPEC_FIELDS)
        raw_codec = _wire_str(data, "codec")
        try:
            codec = AudioCodec(raw_codec)
        except ValueError as error:
            raise NovaInvariantError(f"unknown audio codec {raw_codec!r}") from error
        return cls(
            codec=codec,
            sample_rate=_wire_int(data, "sample_rate"),
            channels=_wire_int(data, "channels"),
            bit_rate=_wire_int(data, "bit_rate"),
        )


@dataclass(frozen=True, slots=True)
class OutputSpec:
    """One export: a container holding one video stream and optional audio.

    This is the unit the export dialog edits, the export history lists and the
    render engine consumes.  It carries no path — *where* the bytes go is a
    property of the job, not of the format.
    """

    container: ContainerFormat
    video: VideoEncodeSpec
    audio: AudioEncodeSpec | None = None
    #: Move the MP4/MOV index to the front so streaming starts immediately.
    faststart: bool = False

    def __post_init__(self) -> None:
        if not self.container.accepts_video(self.video.codec):
            raise NovaInvariantError(
                f"{self.container} cannot carry {self.video.codec}; use "
                f"{sorted(codec.value for codec in CONTAINER_VIDEO_CODECS[self.container])}"
            )
        if self.audio is not None and not self.container.accepts_audio(self.audio.codec):
            raise NovaInvariantError(
                f"{self.container} cannot carry {self.audio.codec}; use "
                f"{sorted(codec.value for codec in CONTAINER_AUDIO_CODECS[self.container])}"
            )
        if self.faststart and self.container not in (ContainerFormat.MP4, ContainerFormat.MOV):
            raise NovaInvariantError(f"faststart applies to mp4 and mov only, not {self.container}")

    @property
    def muxer_name(self) -> str:
        """The FFmpeg muxer for this container."""
        return MUXERS[self.container]

    @property
    def has_audio(self) -> bool:
        """Whether the output carries an audio stream."""
        return self.audio is not None

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "container": str(self.container),
            "video": self.video.to_wire(),
            "audio": self.audio.to_wire() if self.audio else None,
            "faststart": self.faststart,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> OutputSpec:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _OUTPUT_SPEC_FIELDS)
        raw_container = _wire_str(data, "container")
        raw_video = data["video"]
        raw_audio = data["audio"]
        raw_faststart = data["faststart"]
        if not isinstance(raw_video, Mapping):
            raise NovaInvariantError("video must be a mapping")
        if raw_audio is not None and not isinstance(raw_audio, Mapping):
            raise NovaInvariantError("audio must be a mapping or null")
        if not isinstance(raw_faststart, bool):
            raise NovaInvariantError("faststart must be a bool")
        try:
            container = ContainerFormat(raw_container)
        except ValueError as error:
            raise NovaInvariantError(f"unknown container {raw_container!r}") from error
        return cls(
            container=container,
            video=VideoEncodeSpec.from_wire(raw_video),
            audio=AudioEncodeSpec.from_wire(raw_audio) if raw_audio is not None else None,
            faststart=raw_faststart,
        )


@dataclass(frozen=True, slots=True)
class RenderStats:
    """What a finished render reports back.

    Frames and bytes are what a user recognises; elapsed time is what makes
    "this export will take nine minutes" honest instead of guessed.
    """

    frames_written: int = 0
    bytes_written: int = 0
    elapsed_ms: int = 0

    @property
    def frames_per_second(self) -> float:
        """Observed throughput, or ``0.0`` when nothing was measured."""
        if self.elapsed_ms <= 0:
            return 0.0
        return self.frames_written * 1000.0 / self.elapsed_ms


@dataclass(frozen=True, slots=True)
class ToolchainCapabilities:
    """What probing measured, not what we hope is there (ADR-0007 §4).

    Probed once per session and cached by the adapter; re-probed only on
    explicit user action.  Every set is a ``frozenset`` because a capability set
    is a fact about the machine, and a mutable fact is a race waiting for the
    settings screen.
    """

    ffmpeg_version: str = ""
    encoders: frozenset[str] = frozenset()
    decoders: frozenset[str] = frozenset()
    hwaccels: frozenset[str] = frozenset()
    filters: frozenset[str] = frozenset()
    pixel_formats: frozenset[str] = frozenset()

    def supports_encoder(self, name: str) -> bool:
        """Whether an encoder by that name exists in this build."""
        return name in self.encoders

    def supports_pixel_format(self, name: str) -> bool:
        """Whether the toolchain can convert to that pixel format."""
        return name in self.pixel_formats

    def supports_hardware(self, accel: HardwareAccel) -> bool:
        """Whether a hardware family is usable.

        Names differ between the families and FFmpeg's ``-hwaccels`` list
        (``cuda``, ``qsv``, ``amf``, ``videotoolbox``, ``vdpau``, ...), so the
        mapping lives here rather than being guessed at each call site.
        """
        return _HWACCEL_NAMES.get(accel, "") in self.hwaccels

    def can_encode(self, spec: OutputSpec) -> bool:
        """Whether this machine can produce ``spec`` as written."""
        return self.describe_missing(spec) == ""

    def describe_missing(self, spec: OutputSpec) -> str:
        """What stands in the way of encoding ``spec``, or ``""`` when nothing does.

        The string is written for a user, not for a log — it becomes the remedy
        of ``Err(NS-MEDIA-4002)``, which is the difference between "export
        failed" and "H.265 encoding needs libx265, which this build does not
        include; export H.264 instead".
        """
        # Most specific reason first: "this machine has no NVENC" tells the user
        # something actionable, while "no h264_nvenc encoder" is a restatement.
        if spec.video.hardware is not HardwareAccel.NONE and not self.supports_hardware(
            spec.video.hardware
        ):
            return f"{spec.video.hardware} hardware encoding is not available on this machine"
        encoder = spec.video.encoder_name
        if not self.supports_encoder(encoder):
            return f"this build has no {encoder} encoder"
        if not self.supports_pixel_format(spec.video.pixel_format):
            return f"this build cannot convert to {spec.video.pixel_format}"
        if spec.audio is not None and not self.supports_encoder(spec.audio.encoder_name):
            return f"this build has no {spec.audio.encoder_name} encoder"
        return ""


#: Hardware family → the name FFmpeg reports in ``-hwaccels``.
_HWACCEL_NAMES: Final[dict[HardwareAccel, str]] = {
    HardwareAccel.NVENC: "cuda",
    HardwareAccel.QSV: "qsv",
    HardwareAccel.AMF: "amf",
    HardwareAccel.VIDEOTOOLBOX: "videotoolbox",
}


# -- wire helpers -------------------------------------------------------------

_VIDEO_SPEC_FIELDS: Final[set[str]] = {
    "codec",
    "width",
    "height",
    "timebase",
    "rate_control",
    "pixel_format",
    "colour",
    "gop_size",
    "preset",
    "hardware",
}
_AUDIO_SPEC_FIELDS: Final[set[str]] = {"codec", "sample_rate", "channels", "bit_rate"}
_OUTPUT_SPEC_FIELDS: Final[set[str]] = {"container", "video", "audio", "faststart"}
_RATE_CONTROL_FIELDS: Final[set[str]] = {"mode", "crf", "bit_rate", "max_bit_rate"}


def _reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def _wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def _optional_int(data: Mapping[str, object], key: str) -> int | None:
    raw = data[key]
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int or null, got {type(raw).__name__}")
    return raw


def _wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw


def _wire_int_mapping(data: Mapping[str, object], key: str) -> dict[str, int]:
    result: dict[str, int] = {}
    for name, raw in data.items():
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise NovaInvariantError(f"{key}.{name} must be an int")
        result[name] = raw
    return result
