"""L2 port — render: where composed frames and mixed audio go.

The media port reads; this one writes.  Four protocols, narrowest first, in the
same house style:

``FrameSink`` / ``AudioSink``
    One stream of an output: frames or sample blocks in, bytes on disk out.  A
    caller that only has pictures takes the frame sink, not the whole target.
``RenderTarget``
    A muxed output: a video sink, an optional audio sink, and one finish that
    finalises the container.  Separating the streams is what lets audio be mixed
    independently of video (ARCHITECTURE §7.4) and muxed at the end.
``Renderer``
    Opens a target for a spec and a path.
``CapabilityProbe``
    What this machine can actually encode — the difference between offering a
    user H.265 and offering it *and having it work* (ADR-0007 §4).

Contract rules an adapter must honour
-------------------------------------
1. **Nothing may assume an encoder exists.**  The export UI is built from
   :class:`~nova_studio.domain.export.ToolchainCapabilities`, never from a
   hardcoded list.  A missing encoder is
   :attr:`RenderErrorCode.ENCODER_UNAVAILABLE` — ``NS-MEDIA-4002``, the code
   ADR-0007 §7 names — carrying the remedy that
   :meth:`~nova_studio.domain.export.ToolchainCapabilities.describe_missing`
   wrote for the user.
2. **Order is the caller's job, completeness is the adapter's.**  Frames must be
   written in presentation order; the adapter interleaves, timestamps and
   flushes.  Writing interleaved video and audio in whatever order the caller
   produces them is what produces a file with drift.
3. **Finish is the only place a file becomes valid.**  Until :meth:`finish`
   returns ``Ok``, the output is incomplete: no moov atom, no index, no
   duration.  A caller that abandons a render must call :meth:`abort`, which
   removes the partial file — a half-written export left on the user's desktop
   is worse than none.
4. **Failure is a value, cancellation is a value too.**  ``write`` returns
   ``Result``; a cancelled render ends as ``Err(CANCELLED)`` so the job
   framework can distinguish "the user stopped it" from "it broke".
5. **Progress is not this port's business.**  A job reports progress; a sink
   counts.  :class:`~nova_studio.domain.export.RenderStats` is the sink's answer
   at the end, and the job samples it while it runs.  Mixing the two is how a
   renderer ends up importing the scheduler.
6. **No third-party types** — frames are
   :class:`~nova_studio.domain.media.FrameBuffer`, audio is
   :class:`~nova_studio.domain.media.AudioBuffer`, specs are
   :class:`~nova_studio.domain.export.OutputSpec`.

Deliberately not here: *which* backend does the encoding.  ADR-0007 §3 calls the
abstraction that chooses between PyAV and the FFmpeg CLI ``MediaBackend``, and
that choice is made once, at composition time, by the container — it selects
which implementation of these protocols to bind.  Nothing in the domain needs to
know, so no port declares it; capability probing is the only part every backend
must answer, and that is :class:`CapabilityProbe`.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from nova_studio.core import Result
    from nova_studio.domain.export import (
        OutputSpec,
        RenderStats,
        ToolchainCapabilities,
    )
    from nova_studio.domain.media import AudioBuffer, FrameBuffer

__all__ = [
    "AudioSink",
    "CapabilityProbe",
    "FrameSink",
    "RenderErrorCode",
    "RenderTarget",
    "Renderer",
]


class RenderErrorCode(StrEnum):
    """The codes a renderer may return in the ``Err`` half of a ``Result``.

    ``ENCODER_UNAVAILABLE`` keeps the code ADR-0007 §7 assigned
    (``NS-MEDIA-4002``) even though the rest of this enum is ``NS-RENDER-*``:
    that string is what the ADR promises the user will see for a missing
    encoder, and the frontend maps codes, not modules.
    """

    #: The output path cannot be written: missing directory, read-only volume,
    #: no space left on the device.
    SINK_UNWRITABLE = "NS-RENDER-4001"
    #: No encoder for the requested codec is present in this build
    #: (ADR-0007 §7).  The remedy names the encoder and the alternative.
    ENCODER_UNAVAILABLE = "NS-MEDIA-4002"
    #: The encoder rejected the stream or died mid-render: an unsupported pixel
    #: format for that codec, a resolution beyond the level limits, a driver
    #: crash on a hardware encoder.
    ENCODE_FAILED = "NS-RENDER-4003"
    #: The spec asks for a combination nothing can produce — a container that
    #: cannot hold the codec, a bitrate the level forbids.  Caught before the
    #: first frame, unlike ``ENCODE_FAILED``.
    UNSUPPORTED_SPEC = "NS-RENDER-4004"
    #: The render was cancelled.  Not a fault: the job framework returns this so
    #: the UI can say "stopped" instead of "failed".
    CANCELLED = "NS-RENDER-4005"


@runtime_checkable
class FrameSink(Protocol):
    """One video stream of an output: frames in, encoded bytes out."""

    def write(self, frame: FrameBuffer) -> Result[None]:
        """Encode one frame.

        Frames must arrive in presentation order; the adapter assigns
        timestamps from the spec's timebase.  Colour conversion, if any is
        needed, happens here — explicitly, at this boundary, and never as an
        implicit ``swscale`` default (ADR-0007 §6).

        Returns:
            ``Ok(None)``, or ``Err`` carrying
            :attr:`RenderErrorCode.ENCODE_FAILED` when the encoder rejected the
            frame and :attr:`RenderErrorCode.CANCELLED` once the job has been
            cancelled — after which every further write fails the same way.
        """
        ...

    def finish(self) -> Result[RenderStats]:
        """Flush encoder delay frames and close this stream.

        A modern codec holds frames back (lookahead, B-frame reordering), so a
        render that stops after the last ``write`` loses the tail.  The returned
        stats are what the export history records.
        """
        ...

    def abort(self) -> None:
        """Abandon the stream without producing a file.  Idempotent."""
        ...


@runtime_checkable
class AudioSink(Protocol):
    """One audio stream of an output: sample blocks in, encoded bytes out."""

    def write(self, buffer: AudioBuffer) -> Result[None]:
        """Encode one block of samples.

        Blocks arrive in timeline order and contiguously: a gap is silence only
        if the caller writes silence.  The adapter resamples to the spec's rate
        and layout, because that is a property of the output, not of the mix.
        """
        ...

    def finish(self) -> Result[RenderStats]:
        """Flush and close this stream."""
        ...

    def abort(self) -> None:
        """Abandon the stream.  Idempotent."""
        ...


@runtime_checkable
class RenderTarget(Protocol):
    """A muxed output file: one video stream, optionally one audio stream."""

    def video(self) -> FrameSink:
        """The video stream of this output."""
        ...

    def audio(self) -> AudioSink | None:
        """The audio stream, or ``None`` when the spec has no audio."""
        ...

    def finish(self) -> Result[RenderStats]:
        """Finish every stream and finalise the container.

        This is the commit point: index written, duration known, faststart
        applied if it was asked for.  A file is only valid after an ``Ok`` here.
        """
        ...

    def abort(self) -> None:
        """Abandon the render and remove the partial output.  Idempotent."""
        ...


@runtime_checkable
class Renderer(Protocol):
    """Opens a render target.  The factory behind the handle."""

    def open(self, spec: OutputSpec, path: str) -> Result[RenderTarget]:
        """Open ``path`` for writing ``spec``.

        Fails before any frame is composed when the spec cannot be produced —
        :attr:`RenderErrorCode.UNSUPPORTED_SPEC` for an impossible combination
        and :attr:`RenderErrorCode.ENCODER_UNAVAILABLE` for a missing encoder —
        because discovering either one at minute forty of an export is the
        single most infuriating failure this software could offer.

        The path is created atomically where the platform allows (a temporary
        file renamed at ``finish``), so an aborted render never leaves a
        playable-looking but truncated file behind.
        """
        ...


@runtime_checkable
class CapabilityProbe(Protocol):
    """What this machine can encode, measured rather than assumed.

    ADR-0007 §4: capability probing is cached — enumerated once per session and
    re-probed only on explicit user action, because ``ffmpeg -encoders`` and a
    hardware probe are not free and never change by themselves.  The export UI
    is built from what this returns, which is why a build without ``libx265``
    simply does not offer H.265 instead of failing halfway.
    """

    def capabilities(self, *, refresh: bool = False) -> Result[ToolchainCapabilities]:
        """Return the measured capability set.

        Args:
            refresh: Re-probe even if a cached result exists.  Used by the
                "re-detect hardware" button in settings, and after a driver
                update a user was told to install.

        Returns:
            ``Ok(ToolchainCapabilities)``, or ``Err`` when no toolchain could be
            found at all — in which case exporting is unavailable and the UI
            says so with the reason.
        """
        ...
