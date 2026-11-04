# ADR-0005 — Loopback HTTP + WebSocket as the only frontend↔backend channel

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

pywebview provides a JS↔Python bridge (`window.pywebview.api`). It is convenient and we
already ship pywebview for windowing. But an editor needs:

* **streaming** (export progress, ASR partial hypotheses, preview frames),
* **cancellation** (stop a render, stop a transcription),
* **high-frequency updates** (transport position at display rate, drag gestures),
* **back-pressure** (do not queue 10 000 scrub requests),
* **testability** (drive the whole product headlessly from a browser or a script).

The pywebview bridge offers none of these well: it is request/response, serialises every
payload, has no cancellation token, and can only be exercised from inside a native window —
which makes automated UI testing and CI hard.

## Decision

1. The core service runs an **ASGI server on `127.0.0.1` with an ephemeral port**, chosen at
   startup, never fixed (avoids collisions with other apps and with multiple instances).
2. All capability exchange is **REST under `/api/v1`** plus a **single WebSocket at
   `/api/v1/ws`** carrying the event envelope stream and binary frame channels.
3. The pywebview bridge is restricted to **native window concerns only**: show/hide,
   minimise/maximise/fullscreen, native file dialogs, clipboard image, focus, window title,
   quit. A hard lint rule in the frontend forbids `pywebview.api.*` outside
   `core/native/`.
4. **Security:** the shell generates a 256-bit session token at startup, passes it to the
   window once, and the frontend presents it as `Authorization: Bearer` on REST and in the WS
   handshake. The service rejects any request without it, and rejects any `Origin`/`Host`
   that is not `127.0.0.1:<port>` or `localhost:<port>`. Combined with loopback binding,
   this prevents other local processes and any web page the user visits from driving the
   editor (DNS-rebinding and cross-origin attacks are both closed by the Host/Origin check).
5. **Preview transport is pluggable** (`ports/frame_sink.py`):
   * `HttpFrameSink` — MJPEG/WebP over HTTP for browser/headless mode;
   * `WsBinaryFrameSink` — raw/encoded frames over the WS binary channel for the desktop;
   * `SharedMemoryFrameSink` — named shared memory for zero-copy desktop preview.
   The frontend selects at runtime by capability negotiation.
6. **Event envelope** carries `seq`; on gap detection the client sends `resync` and receives
   a full slice snapshot. This makes dropped frames a recoverable, non-fatal event.

## Consequences

**Positive**

* The product is fully drivable from a browser: `make dev` runs backend + Vite and a
  developer gets hot reload and real devtools, with no native window in the loop.
* CI can run end-to-end tests against a real backend with `httpx` + Playwright.
* One documented, versioned contract (`docs/architecture/api-contract.md`) instead of an
  implicit JS bridge surface.
* Cancellation and back-pressure are solved once, in the transport layer.
* A future remote/collaborative client reuses everything.

**Negative / accepted**

* A port must be allocated and communicated to the window; handled by the shell writing the
  URL and token into the window's initial payload.
* Slightly higher per-call overhead than an in-process bridge (~0.1–0.5 ms on loopback).
  Acceptable; hot paths (scrubbing) use optimistic UI and binary frames.
* We must defend the endpoint ourselves (token + Host/Origin checks). Accepted, and covered
  by `tests/api/test_transport_security.py`.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| pywebview bridge only | No streaming, cancellation, back-pressure, or headless testability |
| gRPC / protobuf | Excellent perf, but no browser support without grpc-web proxies, and a heavier toolchain for a UI that needs JSON-ish flexibility |
| Unix domain sockets / named pipes | Not available in a browser; would need a second transport for dev mode anyway |
| Electron IPC | Would require abandoning the Python-authority model (ADR-0003) |
| Fixed port (e.g. 8765) | Collides with other software and forbids multiple instances |
