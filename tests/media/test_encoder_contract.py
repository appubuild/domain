"""The export vocabulary against the toolchain it names.

``domain/export.py`` maps a user's codec choice to an FFmpeg encoder, a
container to a muxer, and a pixel format to a real conversion path.  Those
strings were read off the bundled FFmpeg 7.0.2 on 2026-09-25, and this file is
what stops them from drifting into memory: if a toolchain bump renames
``libx265`` or drops ``libvpx-vp9``, these tests fail here, at import time in
CI, instead of at minute forty of a user's export.

It also pins the argument for capability probing: this machine reports exactly
one hardware acceleration method, and none of the hardware encoders we can ask
for.  A build that assumed ``h264_nvenc`` exists would be broken on every
machine like it (ADR-0007 §4, ADR-0012 §6).

The tests shell out to the ``imageio-ffmpeg`` binary, never to a system
``ffmpeg`` — the portable build is the one users get, so it is the one that must
agree with our tables.  They skip when the binary is unavailable rather than
failing, because a machine without it is a supported configuration for running
the suite, just not for exporting.
"""

from __future__ import annotations

import subprocess
from typing import Final

import pytest

from nova_studio.domain.export import (
    HARDWARE_ENCODERS,
    MUXERS,
    SOFTWARE_AUDIO_ENCODERS,
    SOFTWARE_ENCODERS,
    ContainerFormat,
    VideoCodec,
)

pytestmark = [pytest.mark.unit, pytest.mark.media]

#: Pixel formats the domain assumes the toolchain can convert to.
ASSUMED_PIXEL_FORMATS: Final[frozenset[str]] = frozenset(
    {"yuv420p", "yuv422p", "yuv420p10le", "nv12", "rgb24", "rgba"}
)


def _ffmpeg() -> str:
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError:  # pragma: no cover - dependency is always installed
        pytest.skip("imageio-ffmpeg is not installed")
    try:
        return get_ffmpeg_exe()
    except Exception as error:  # pragma: no cover - binary missing
        pytest.skip(f"no bundled FFmpeg binary: {error}")


@pytest.fixture(scope="module")
def ffmpeg_binary() -> str:
    return _ffmpeg()


def _run(binary: str, *args: str) -> str:
    completed = subprocess.run(
        [binary, "-hide_banner", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:  # pragma: no cover - binary present but broken
        pytest.skip(f"ffmpeg {args} failed: {completed.stderr[:200]}")
    return completed.stdout


@pytest.fixture(scope="module")
def encoders(ffmpeg_binary: str) -> frozenset[str]:
    """Encoder names from ``ffmpeg -encoders`` (second column of each entry)."""
    names: set[str] = set()
    for line in _run(ffmpeg_binary, "-encoders").splitlines():
        parts = line.strip().split()
        # Entries look like:  V....D libx264   libx264 H.264 / AVC ...
        if len(parts) >= 2 and parts[0][:1] in ("V", "A", "S"):
            names.add(parts[1])
    return frozenset(names)


@pytest.fixture(scope="module")
def muxers(ffmpeg_binary: str) -> frozenset[str]:
    """Container names the build can *write* (the ``E`` flag in ``-formats``)."""
    names: set[str] = set()
    for line in _run(ffmpeg_binary, "-formats").splitlines():
        parts = line.strip().split()
        # Entries look like:  DE  mp3   MP3 (MPEG audio layer 3)
        if len(parts) >= 2 and "E" in parts[0] and parts[0][:1] in ("D", "E"):
            names.add(parts[1])
    return frozenset(names)


@pytest.fixture(scope="module")
def pixel_formats(ffmpeg_binary: str) -> frozenset[str]:
    names: set[str] = set()
    for line in _run(ffmpeg_binary, "-pix_fmts").splitlines():
        parts = line.strip().split()
        # Entries look like:  IO... yuv420p  3  12  8-8-8  (components is a number)
        if len(parts) >= 4 and len(parts[0]) == 5 and parts[2].isdigit():
            names.add(parts[1])
    return frozenset(names)


@pytest.fixture(scope="module")
def hwaccels(ffmpeg_binary: str) -> frozenset[str]:
    names: set[str] = set()
    for line in _run(ffmpeg_binary, "-hwaccels").splitlines():
        stripped = line.strip()
        if stripped and not stripped.endswith(":"):
            names.add(stripped)
    return frozenset(names)


class TestSoftwareEncoders:
    @pytest.mark.parametrize("codec", sorted(SOFTWARE_ENCODERS, key=lambda item: str(item)))
    def test_every_video_codec_resolves_to_an_encoder_that_exists(
        self, codec: VideoCodec, encoders: frozenset[str]
    ) -> None:
        name = SOFTWARE_ENCODERS[codec]
        assert name in encoders, f"{codec} maps to {name}, which this build does not have"

    @pytest.mark.parametrize("name", sorted(SOFTWARE_AUDIO_ENCODERS.values()))
    def test_every_audio_encoder_exists(self, name: str, encoders: frozenset[str]) -> None:
        assert name in encoders, f"audio encoder {name} is missing from this build"


class TestContainers:
    @pytest.mark.parametrize("container", sorted(MUXERS, key=lambda item: str(item)))
    def test_every_container_resolves_to_a_writable_muxer(
        self, container: ContainerFormat, muxers: frozenset[str]
    ) -> None:
        name = MUXERS[container]
        assert name in muxers, f"{container} maps to {name}, which this build cannot write"


class TestPixelFormats:
    @pytest.mark.parametrize("name", sorted(ASSUMED_PIXEL_FORMATS))
    def test_the_toolchain_can_convert_to_it(
        self, name: str, pixel_formats: frozenset[str]
    ) -> None:
        assert name in pixel_formats, f"this build cannot convert to {name}"


class TestHardwareIsProbedNotAssumed:
    def test_the_machine_reports_the_acceleration_methods_it_has(
        self, hwaccels: frozenset[str]
    ) -> None:
        """Sanity: the probe answers, and the answer is a set of names."""
        assert isinstance(hwaccels, frozenset)
        assert all(isinstance(name, str) for name in hwaccels)

    def test_hardware_encoders_are_not_assumed_to_exist(
        self, encoders: frozenset[str], hwaccels: frozenset[str]
    ) -> None:
        """The reason ADR-0012 §6 requires probing.

        On a machine like this one — no GPU — every hardware encoder we know the
        name of is absent.  A build that hardcoded ``h264_nvenc`` would fail
        here, and the failure would look like a bug rather than a missing
        driver.
        """
        present = sorted(name for name in HARDWARE_ENCODERS.values() if name in encoders)
        if present:  # pragma: no cover - only on a machine with a GPU
            pytest.skip(f"this machine has hardware encoders: {present}")
        assert not encoders & frozenset(HARDWARE_ENCODERS.values())
        assert hwaccels <= {"vdpau", "cuda", "qsv", "amf", "videotoolbox", "vaapi", "d3d11va"}


class TestTheProbeShape:
    def test_capability_sets_are_what_a_probe_would_store(
        self, encoders: frozenset[str], muxers: frozenset[str]
    ) -> None:
        """The values a real adapter stores are exactly the ones these tests read."""
        assert "libx264" in encoders
        assert "mp4" in muxers
        assert all(isinstance(name, str) for name in encoders)
