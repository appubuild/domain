"""L4 — infrastructure: the concrete adapters.

This is the only ring allowed to touch the outside world.  Every native dependency
lives behind a port implemented here, so the cost of replacing one is confined to
one directory (ADR-0002).

``infra`` is where the banned-import list is *permitted*: ``av``, ``cv2``, ``PIL``,
``sqlite3``, ``faster_whisper``, ``ctranslate2``, ``imageio_ffmpeg``,
``onnxruntime``, ``watchfiles``.  Anywhere else in the package, importing them
fails the build.

Hard rules:

1. **Implements a port, exports no new interface.**  A consumer in L2/L3 names the
   port; nothing outside ``infra`` and ``api`` imports an adapter directly.  The
   binding is registered in the DI container at composition time.
2. **Failure is translated at this boundary.**  A ``av.error.ValueError`` from
   PyAV, an ``sqlite3.OperationalError``, a CUDA out-of-memory — each becomes a
   ``NovaError`` with a stable ``NS-<DOMAIN>-<NNNN>`` code before it travels
   inward.  Native exception types must not leak into services, because their
   messages change between library versions and the frontend localises on codes,
   not strings.
3. **Resource discipline is explicit.**  Containers are closed, buffers are
   released, GPU memory is accounted against the VRAM ledger (ADR-0012).  A decode
   loop that leaks a file handle will exhaust the OS limit partway through a
   feature-length export, which is the worst possible moment to discover it.
4. **May import** anything, including third-party libraries — it is the outermost
   ring.  May not be imported by ``core``, ``domain``, ``ports`` or ``services``.

Adapters (populated in Stages 3–12)::

    media/         PyAV decoding and encoding, FFmpeg CLI fallback, probing
    imaging/       OpenCV and Pillow frame operations, colour conversion
    persistence/   SQLite metadata store, JSON WAL, .nova project archive
    asr/           faster-whisper transcription, alignment, translation
    render/        GPU probes, shader-backed effects, encoder selection
    filesystem/    media discovery, thumbnail cache, file watching
    platform/      process supervision, single-instance lock, paths
    clock.py       the real Clock and IdFactory implementations

Performance note: adapters are the only place where a per-frame allocation or an
unnecessary colour-space round trip is acceptable to trade for correctness, but
they are also where such a mistake costs the most.  Anything on the frame path is
benchmarked against ``scripts/bench_render.py`` baselines before it merges.
"""

from __future__ import annotations
