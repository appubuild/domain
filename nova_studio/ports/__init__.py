"""L2 — ports: the interfaces the outside world must satisfy.

A port is the seam where the domain and services say *what* they need and an
adapter in ``infra`` decides *how* to provide it.  ``services`` depends on these
declarations and never on ``infra``; the DI container binds one to the other at
composition time (ADR-0002 rule 3).

That inversion is the whole point.  It is why swapping PyAV for an FFmpeg CLI
backend, SQLite for another store, or faster-whisper for a different ASR engine is
one new adapter plus one rebinding — not a rewrite of the engines that depend on
them.  It is also why a render can be unit-tested with a fake decoder that returns
synthetic frames.

Hard rules, enforced by ``scripts/check_layering.py``:

1. **Declarations only.**  ``typing.Protocol`` or ``abc.ABC`` with signatures and
   docstrings.  No implementation, no default behaviour beyond a trivial
   ``NotImplementedError``.
2. **No third-party types in signatures.**  A port may not mention
   ``av.VideoFrame`` or ``faster_whisper.WhisperModel`` — that would re-couple
   every consumer to the adapter it is meant to be insulated from.  The single
   sanctioned exception is ``numpy.ndarray`` as a frame buffer, re-exported from
   ``domain.media`` (ADR-0002 rule 2).
3. **May import** ``nova_studio.core``, ``nova_studio.domain`` and the stdlib.
   ``domain`` and ``ports`` are both L2 and may reference each other.

When to write a port — the rule that prevents "interface for everything":

    A port exists only when there are two or more plausible implementations,
    **or** the dependency performs I/O.

Value objects and pure functions do not get ports; wrapping them adds indirection
without adding any ability to substitute.  Concretely: ``MediaDecoder`` is a port
(PyAV and FFmpeg CLI both implement it, and it does I/O).  ``Timebase`` is not
(it is arithmetic).

Modules (populated in Stage 3)::

    clock.py       WallReading, MonotonicReading, Clock, ControllableClock
    ident.py       IdSource, IdGenerator — the injected identity
    media.py       probing, decoding, frame access, audio resampling
    persistence.py project store, crash-recovery log, asset cache
    render.py      frame/audio sinks, render targets, toolchain capability probe
    gpu.py         GpuBackend: per-operation acceleration (ADR-0012 §2)
    asr.py         transcription, alignment, translation
    jobs.py        worker execution, cancellation, progress reporting
    filesystem.py  media discovery, thumbnails, file watching
"""

from __future__ import annotations
