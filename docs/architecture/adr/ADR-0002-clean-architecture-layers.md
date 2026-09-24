# ADR-0002 — Four-ring Clean Architecture with enforced import direction

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

A video editor accumulates subsystems over a decade: codecs come and go, GPU APIs are
rewritten every few years, ASR models improve quarterly, UI frameworks get replaced. The
code that must survive all of that is the *domain* — what a timeline, a clip, a caption and
a project actually are, and the invariants they must hold.

If domain logic calls `av.open()` directly, then the day we need a different decoder or want
to unit-test an edit decision, we inherit FFmpeg as a test dependency. In practice this is
how NLE codebases become untestable and unrefactorable.

## Decision

Four rings, dependencies point strictly inward:

```
L1  core/       infrastructure-agnostic kernel
L2  domain/     entities, value objects, invariants, domain events
    ports/      abstract interfaces the outside world must satisfy
L3  services/   application services + engines (use cases, orchestration)
L4  infra/      concrete adapters (SQLite, PyAV, OpenCV, Whisper, caches)
    api/        FastAPI routers, DTO mapping, WebSocket bridge
    apps/       desktop shell
```

Hard rules:

1. `domain/` imports only `core/` and the stdlib. It contains **no I/O of any kind** —
   no file, network, database, clock (`datetime.now`), or randomness (`random`) access.
   Time and identifiers are injected (`Clock`, `IdFactory` ports).
2. `ports/` declares `typing.Protocol` or `abc.ABC` interfaces only. No implementation, no
   third-party types in signatures. A port signature may not mention `av.VideoFrame`,
   `numpy.ndarray` is permitted only where a frame buffer abstraction is unavoidable and is
   then re-exported from `domain/media.py`.
3. `services/` depends on `ports/`, never on `infra/`. It receives adapters from the DI
   container.
4. `api/` contains no business logic: it validates input, calls one service method, maps the
   result to a DTO. A router function that is longer than ~25 lines is a smell.
5. `core/` knows nothing about video editing and nothing about this application's
   frameworks. It could be lifted into another product, and it must stay cheap to
   import because every process in the system pays that cost at startup.
6. **The inner two rings are framework-free.** `pydantic` is permitted in `api/` and
   `infra/` only. Domain entities and value objects are plain frozen dataclasses;
   wire DTOs are pydantic models defined in `api/`. Rationale:

   * pydantic is a *wire-boundary* concern — validation of untrusted input and
     serialisation outward. Using it to model the domain couples the longest-lived
     code in the product to a serialisation framework's major versions.
   * The cost is measurable, not hypothetical. A single `from pydantic import
     BaseModel` in `core/events.py` raised the L1 import footprint from **51 modules
     (~50 ms) to 203 modules (~150 ms)** and transitively loaded `socket`, `ssl`,
     `subprocess` and `urllib` into every render worker, plugin host and CLI
     invocation. That was one `isinstance` check.
   * `EventEnvelope.to_wire()` duck-types `model_dump()` instead of importing
     pydantic, so an outer ring may still publish pydantic payloads and have them
     serialised correctly.

   `tests/core/test_public_api.py::TestLayerPurity` asserts the loaded module graph
   of `nova_studio.core` in a fresh subprocess, so a regression here fails the build
   rather than arriving silently with the next dependency.

**Enforcement is mechanical, not cultural.** Two gates, checking different things:

* `scripts/check_layering.py` parses the import graph with `ast` and fails CI on any
  violation. Banned imports (`sqlite3`, `av`, `cv2`, `faster_whisper`, `pydantic`, …)
  outside their allowed ring are rejected, `domain/` and `core/` purity is enforced,
  and `services/` features are kept isolated from one another.
* `tests/core/test_public_api.py` inspects the **loaded** module graph in a fresh
  subprocess. The textual scan cannot see transitive dependencies — pydantic reached
  `socket` and `ssl` without any core module naming them — so this gate asserts what
  the kernel actually pulls in at runtime, plus an explicit module budget.

A source-level scan and a runtime-level scan disagree often enough that both are
worth maintaining.

## Consequences

**Positive**

* Domain and service logic is testable with zero native dependencies — the majority of the
  test suite runs in milliseconds with no FFmpeg, no GPU, no model weights.
* Swapping a decoder, ASR engine, cache or database is a new adapter plus one rebinding.
* Plugins bind to ports; they cannot bypass them, which keeps the plugin surface small.
* New engineers can locate any behaviour by ring before by feature.

**Negative / accepted**

* More files and more indirection than a script-style codebase. Accepted: the indirection
  is the product's longevity insurance.
* Mapping between domain entities and DTOs is boilerplate. Mitigated by explicit
  `api/schemas/mappers` and by keeping DTOs deliberately close to entities.
* Naive use of ports can produce "interface for everything". Rule: a port exists only when
  there are ≥ 2 plausible implementations **or** the dependency performs I/O. Value objects
  and pure functions do not get ports.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Layered "by technology" (models/views/controllers) | Cross-cutting features end up spread across every layer; no invariant ownership |
| Feature-first (vertical slices, no rings) | Excellent for CRUD apps; in an NLE the *same* domain objects are touched by editing, rendering, export, captions and AI — slicing by feature duplicates invariants |
| Hexagonal with a single `adapters` package | Equivalent in spirit; we split `infra` from `api` because their failure modes and review needs differ (perf vs contract) |
| No enforced layering (convention only) | Every large codebase we have audited violates convention within two quarters |
