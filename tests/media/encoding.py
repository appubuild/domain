"""Shared encoders for tests that need a real media file.

Nothing in here is a fixture on purpose: a media file in a repository is a file
nobody can regenerate when the toolchain moves, and a probe test is exactly the
test that must survive a toolchain bump. So the files are encoded, in a temporary
directory, by the same PyAV that will read them back.

Encoding thirty frames costs a few milliseconds, which is why two test
directories share one set of helpers rather than each growing its own.
"""

from __future__ import annotations

import fractions
from typing import TYPE_CHECKING

import av
import numpy as np

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "FRAMES",
    "HEIGHT",
    "RATE",
    "SAMPLE_RATE",
    "WIDTH",
    "write_audio_only",
    "write_pcm16_wav",
    "write_song_with_cover_art",
    "write_still",
    "write_video",
]

RATE = fractions.Fraction(30_000, 1001)
FRAMES = 30
WIDTH, HEIGHT = 320, 240
SAMPLE_RATE = 48_000


# ---------------------------------------------------------------------------
# Making the files
# ---------------------------------------------------------------------------


def _video_frames():
    """`FRAMES` distinct frames, so a probe that counted wrong would show it."""
    for index in range(FRAMES):
        yield np.full((HEIGHT, WIDTH, 3), index * 7 % 255, dtype=np.uint8)


def _audio_frames():
    for index in range(10):
        frame = av.AudioFrame.from_ndarray(
            np.full((2, 1024), 0.1 * (index % 2), dtype=np.float32),
            format="fltp",
            layout="stereo",
        )
        frame.sample_rate = SAMPLE_RATE
        frame.pts = index * 1024
        yield frame


def write_video(
    path: Path,
    *,
    with_audio: bool = True,
    video_codec: str = "libx264",
    frames: int = FRAMES,
    gop: int | None = None,
) -> Path:
    """A real, playable file: h264 at 29.97, with AAC when asked.

    Every stream is declared before the first packet is muxed. PyAV fixes a
    stream's time base when the container's header is written, and one added
    afterwards has none — the first packet out of it then fails with "cannot
    rebase to zero time", which is a message that names neither the cause nor
    the stream.

    `gop` sets the keyframe interval, which a decode test needs in order to have
    more than one keyframe to seek to: a 30-frame clip encoded with libx264's
    default interval of 250 is a single GOP.
    """
    with av.open(str(path), "w") as container:
        video = container.add_stream(video_codec, rate=RATE)
        video.width, video.height, video.pix_fmt = WIDTH, HEIGHT, "yuv420p"
        if gop is not None:
            video.options = {"g": str(gop)}
        audio = container.add_stream("aac", rate=SAMPLE_RATE) if with_audio else None

        for index, array in enumerate(_video_frames()):
            if index >= frames:
                break
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            for packet in video.encode(frame):
                container.mux(packet)
        for packet in video.encode():
            container.mux(packet)

        if audio is not None:
            for frame in _audio_frames():
                for packet in audio.encode(frame):
                    container.mux(packet)
            for packet in audio.encode():
                container.mux(packet)

    return path


def write_song_with_cover_art(path: Path) -> Path:
    """Audio with one picture attached.

    The case that makes "does this file contain a picture" the wrong question to
    ask about an audio file.
    """
    with av.open(str(path), "w") as container:
        audio = container.add_stream("aac", rate=SAMPLE_RATE)
        art = container.add_stream("libx264", rate=fractions.Fraction(1, 1))
        art.width, art.height, art.pix_fmt = 64, 64, "yuv420p"

        for frame in _audio_frames():
            for packet in audio.encode(frame):
                container.mux(packet)
        for packet in audio.encode():
            container.mux(packet)

        picture = av.VideoFrame.from_ndarray(np.zeros((64, 64, 3), dtype=np.uint8), format="rgb24")
        for packet in art.encode(picture):
            container.mux(packet)
        for packet in art.encode():
            container.mux(packet)
    return path


def write_audio_only(path: Path) -> Path:
    """A file with no picture at all."""
    with av.open(str(path), "w") as container:
        audio = container.add_stream("aac", rate=SAMPLE_RATE)
        for frame in _audio_frames():
            for packet in audio.encode(frame):
                container.mux(packet)
        for packet in audio.encode():
            container.mux(packet)
    return path


def write_still(path: Path) -> Path:
    """One picture, through the image demuxer FFmpeg uses for a bare PNG."""
    with av.open(str(path), "w") as container:
        still = container.add_stream("png", rate=fractions.Fraction(1, 1))
        still.width, still.height, still.pix_fmt = 64, 48, "rgb24"
        frame = av.VideoFrame.from_ndarray(np.zeros((48, 64, 3), dtype=np.uint8), format="rgb24")
        for packet in still.encode(frame):
            container.mux(packet)
        for packet in still.encode():
            container.mux(packet)
    return path


def write_pcm16_wav(path: Path, *, blocks: int = 4, level: float = 0.5) -> Path:
    """16-bit integer audio, the format that is *not* already float.

    The decode tests need one, because a decoder adapter that only ever handled
    `fltp` would pass every test written against AAC and fail on a WAV.
    """
    with av.open(str(path), "w") as container:
        audio = container.add_stream("pcm_s16le", rate=8_000)
        for index in range(blocks):
            integers = (np.full((1, 800), level, dtype=np.float32) * 32767).astype(np.int16)
            frame = av.AudioFrame.from_ndarray(integers, format="s16p", layout="mono")
            frame.sample_rate = 8_000
            frame.pts = index * 800
            for packet in audio.encode(frame):
                container.mux(packet)
        for packet in audio.encode():
            container.mux(packet)
    return path
