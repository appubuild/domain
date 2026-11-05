"""`infra/media.py` — the PyAV prober, against files PyAV itself encoded.

The files in these tests are made here rather than committed, because a media
fixture in a repository is a file nobody can regenerate when the toolchain
moves — and a probe test is exactly the test that must survive a toolchain
bump. Encoding thirty frames costs a few milliseconds.

What is being pinned is what the port promises and what an adapter is tempted
to break:

* **A rate is exact.** 29.97 fps stays `30000/1001` and does not become a float
  on its way to the timeline; a frame count derived from a rounded rate drifts
  by a frame every few minutes of footage.
* **The kind comes from the contents, never the suffix.** An MP3 with a picture
  is audio; a still is an image; a file with nothing in it is `UNKNOWN` and
  still imports.
* **`4001` and `4003` are different answers.** One is the user's problem, the
  other is ours, and a prober that collapsed them would tell someone to check a
  file that is fine.
* **A probe is stateless and shareable**, which is why one instance can serve a
  folder of forty imports.
"""

from __future__ import annotations

import concurrent.futures
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.domain.media import AssetKind
from nova_studio.infra.media import PyAVProber, _rotation_of
from nova_studio.ports.media import MediaErrorCode
from tests.media.encoding import (
    FRAMES,
    HEIGHT,
    SAMPLE_RATE,
    WIDTH,
    write_audio_only,
    write_song_with_cover_art,
    write_still,
    write_video,
)

if TYPE_CHECKING:
    from pathlib import Path

pytest.importorskip("av", reason="PyAV is the adapter under test")
av = pytest.importorskip("av")

pytestmark = [pytest.mark.unit, pytest.mark.media]


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_video(tmp_path_factory.mktemp("media") / "clip.mp4")


@pytest.fixture(scope="module")
def silent_clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_video(tmp_path_factory.mktemp("media") / "silent.mp4", with_audio=False)


@pytest.fixture(scope="module")
def still(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_still(tmp_path_factory.mktemp("media") / "frame.png")


@pytest.fixture(scope="module")
def audio_only(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_audio_only(tmp_path_factory.mktemp("media") / "voice.m4a")


@pytest.fixture(scope="module")
def with_cover_art(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_song_with_cover_art(tmp_path_factory.mktemp("media") / "song.mkv")


@pytest.fixture
def prober() -> PyAVProber:
    return PyAVProber()


# ---------------------------------------------------------------------------
# What a video file says about itself
# ---------------------------------------------------------------------------


class TestAVideoClip:
    def test_it_is_video(self, prober: PyAVProber, clip: Path) -> None:
        assert prober.probe(str(clip)).unwrap().kind is AssetKind.VIDEO

    def test_the_rate_is_exact_not_rounded(self, prober: PyAVProber, clip: Path) -> None:
        """29.97 as a float is 29.97002997002997, and a frame count derived from
        it drifts by a frame every few minutes of footage."""
        timebase = prober.probe(str(clip)).unwrap().video[0].timebase
        assert (timebase.num, timebase.den) == (30_000, 1001)
        assert timebase.num / timebase.den != 29.97

    def test_its_geometry_and_codec(self, prober: PyAVProber, clip: Path) -> None:
        video = prober.probe(str(clip)).unwrap().video[0]
        assert video.codec_name == "h264"
        assert (video.width, video.height) == (WIDTH, HEIGHT)
        assert video.frame_count == FRAMES
        assert video.pixel_format == "yuv420p"

    def test_its_audio(self, prober: PyAVProber, clip: Path) -> None:
        info = prober.probe(str(clip)).unwrap()
        assert info.has_audio
        audio = info.audio[0]
        assert audio.codec_name == "aac"
        assert audio.sample_rate == SAMPLE_RATE
        assert audio.channels == 2
        assert audio.channel_layout == "stereo"
        assert audio.sample_count > 0, "a count of zero would silence the clip"

    def test_the_sample_count_is_samples_not_packets(self, prober: PyAVProber, clip: Path) -> None:
        """An AAC packet holds 1024 samples; counting packets would understate
        the length of the audio by a factor of a thousand.

        Within a packet of ten, because an AAC encoder trims its own priming:
        what is being pinned is the order of magnitude, not the last 16 samples.
        """
        audio = prober.probe(str(clip)).unwrap().audio[0]
        assert 9 * 1024 < audio.sample_count <= 10 * 1024

    def test_its_duration(self, prober: PyAVProber, clip: Path) -> None:
        seconds = prober.probe(str(clip)).unwrap().duration_seconds
        assert seconds == pytest.approx(FRAMES * 1001 / 30_000, abs=0.05)

    def test_the_container_names_itself_once(self, prober: PyAVProber, clip: Path) -> None:
        """FFmpeg answers with the list of suffixes it handles
        (`mov,mp4,m4a,3gp,...`); one name is what a person would call it."""
        assert prober.probe(str(clip)).unwrap().container_format == "mov"

    def test_its_tags_are_carried_not_lived_in(self, prober: PyAVProber, clip: Path) -> None:
        """A probe must outlive the file it read, so it holds a copy."""
        info = prober.probe(str(clip)).unwrap()
        assert "encoder" in info.metadata


class TestWhatCountsAsWhat:
    def test_a_clip_without_sound_is_still_video(
        self, prober: PyAVProber, silent_clip: Path
    ) -> None:
        info = prober.probe(str(silent_clip)).unwrap()
        assert info.kind is AssetKind.VIDEO
        assert not info.has_audio

    def test_a_still_is_an_image_with_one_frame(self, prober: PyAVProber, still: Path) -> None:
        info = prober.probe(str(still)).unwrap()
        assert info.kind is AssetKind.IMAGE
        assert info.video[0].frame_count == 1
        assert (info.video[0].timebase.num, info.video[0].timebase.den) == (1, 1)

    def test_a_file_with_only_sound_is_audio(self, prober: PyAVProber, audio_only: Path) -> None:
        info = prober.probe(str(audio_only)).unwrap()
        assert info.kind is AssetKind.AUDIO
        assert not info.has_video
        assert info.audio[0].channels == 2

    def test_cover_art_does_not_make_a_song_a_video(
        self, prober: PyAVProber, with_cover_art: Path
    ) -> None:
        """The question is not 'does it contain a picture' but 'does it move'."""
        info = prober.probe(str(with_cover_art)).unwrap()
        assert info.kind is AssetKind.AUDIO
        assert info.has_video, "the cover is reported; it is just not what the file is"


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


class TestRefusals:
    def test_an_empty_path_is_unreadable(self, prober: PyAVProber) -> None:
        assert prober.probe("").unwrap_err().code == MediaErrorCode.UNREADABLE

    def test_a_missing_file_is_unreadable(self, prober: PyAVProber, tmp_path: Path) -> None:
        error = prober.probe(str(tmp_path / "gone.mp4")).unwrap_err()
        assert error.code == MediaErrorCode.UNREADABLE
        assert "no such file" in str(error.cause)

    def test_a_directory_says_it_is_a_directory(self, prober: PyAVProber, tmp_path: Path) -> None:
        error = prober.probe(str(tmp_path)).unwrap_err()
        assert error.code == MediaErrorCode.UNREADABLE
        assert "directory" in str(error.cause)

    def test_a_file_that_is_not_media_is_unreadable(
        self, prober: PyAVProber, tmp_path: Path
    ) -> None:
        notes = tmp_path / "notes.txt"
        notes.write_text("this is not footage", encoding="utf-8")
        error = prober.probe(str(notes)).unwrap_err()
        assert error.code == MediaErrorCode.UNREADABLE
        assert "not a media file" in str(error.cause)

    def test_a_codec_this_build_lacks_is_our_problem_not_theirs(
        self, prober: PyAVProber, clip: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`4003` and `4001` differ: one tells the user to pick another file,
        the other tells us this build cannot read a file that is fine."""
        monkeypatch.setattr(av, "codecs_available", frozenset())
        error = prober.probe(str(clip)).unwrap_err()
        assert error.code == MediaErrorCode.UNSUPPORTED
        assert error.details == {"codec": "h264"}

    def test_the_remedy_says_whose_problem_it_is(
        self, prober: PyAVProber, clip: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(av, "codecs_available", frozenset())
        remedy = str(prober.probe(str(clip)).unwrap_err().remedy)
        assert "build" in remedy


# ---------------------------------------------------------------------------
# The adapter's own promises
# ---------------------------------------------------------------------------


class TestTheProberItself:
    def test_two_probes_agree(self, prober: PyAVProber, clip: Path) -> None:
        """Stateless: an instance that remembered something would eventually
        describe a file it was not given."""
        assert prober.probe(str(clip)).unwrap() == prober.probe(str(clip)).unwrap()

    def test_one_instance_serves_several_threads(self, prober: PyAVProber, clip: Path) -> None:
        """The port promises thread-safety, because import runs a folder of
        files through one prober."""
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: prober.probe(str(clip)), range(4)))
        assert all(result.is_ok() for result in results)
        first = results[0].unwrap()
        assert all(result.unwrap() == first for result in results)

    def test_rotation_is_read_from_the_tag(self) -> None:
        """PyAV 18 exposes no stream side data, so the tag is all there is — and
        a rotated phone clip laid out sideways is a bug users notice."""
        assert _rotation_of(_Stream({"rotate": "90"})) == 90
        assert _rotation_of(_Stream({"rotate": "180"})) == 180
        assert _rotation_of(_Stream({"rotate": "-90"})) == 270
        assert _rotation_of(_Stream({"rotate": "45"})) == 0
        assert _rotation_of(_Stream({"rotate": "sideways"})) == 0
        assert _rotation_of(_Stream({})) == 0

    def test_a_stream_with_no_aspect_ratio_is_square(self, prober: PyAVProber, clip: Path) -> None:
        from fractions import Fraction

        assert prober.probe(str(clip)).unwrap().video[0].sample_aspect_ratio == Fraction(1)


class _Stream:
    """The smallest thing that looks like a stream to `_rotation_of`."""

    def __init__(self, metadata: dict[str, str]) -> None:
        self.metadata: Any = metadata
