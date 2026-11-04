# Architectural Decision Records

An ADR records a decision that is **expensive to reverse**. Format: Context → Decision →
Consequences → Alternatives considered. ADRs are immutable once accepted; to change a
decision, write a new ADR that supersedes it and mark the old one `Superseded by ADR-NNNN`.

| ID | Title | Status | Date |
| --- | --- | --- | --- |
| [ADR-0001](ADR-0001-monorepo-layout.md) | Monorepo layout with `src`-style Python package | Accepted | 2026-09-24 |
| [ADR-0002](ADR-0002-clean-architecture-layers.md) | Four-ring Clean Architecture with enforced import direction | Accepted | 2026-09-24 |
| [ADR-0003](ADR-0003-python-core-service.md) | Python core service as the single authority for project state | Accepted | 2026-09-24 |
| [ADR-0004](ADR-0004-hybrid-persistence.md) | Hybrid normalised + document persistence in SQLite | Accepted | 2026-09-24 |
| [ADR-0005](ADR-0005-local-http-ws-transport.md) | Loopback HTTP + WebSocket as the only frontend↔backend channel | Accepted | 2026-09-24 |
| [ADR-0006](ADR-0006-frame-accurate-time.md) | Integer frame timebase as the canonical time representation | Accepted | 2026-09-24 |
| [ADR-0007](ADR-0007-pyav-first-media.md) | PyAV-first media I/O with a CLI fallback backend | Accepted | 2026-09-24 |
| [ADR-0008](ADR-0008-command-undo-model.md) | Command pattern with per-scope undo stacks and coalescing | Accepted | 2026-09-24 |
| [ADR-0009](ADR-0009-caption-engine.md) | Caption engine as an independent, provider-portable pipeline | Accepted | 2026-09-24 |
| [ADR-0010](ADR-0010-job-scheduler.md) | Unified job scheduler with priorities and process isolation | Accepted | 2026-09-24 |
| [ADR-0011](ADR-0011-plugin-sandbox.md) | In-process plugins under a declared permission set | Accepted | 2026-09-24 |
| [ADR-0012](ADR-0012-gpu-optional.md) | GPU as optional per-operation acceleration, never a requirement | Accepted | 2026-09-24 |
| [ADR-0013](ADR-0013-frontend-state.md) | Zustand slices as ViewModels; views never call the API | Accepted | 2026-09-24 |
| [ADR-0014](ADR-0014-portable-packaging.md) | PyInstaller onedir portable layout with adjacent data dir | Accepted | 2026-09-24 |
| [ADR-0015](ADR-0015-project-file-format.md) | `.nova` project file as a versioned container | Accepted | 2026-09-24 |
| [ADR-0016](ADR-0016-testing-strategy.md) | Test pyramid with generated media fixtures, never committed | Accepted | 2026-09-24 |

## When you must write an ADR

Write one if the answer to any of these is "yes":

1. Does it change a directory boundary or an import rule?
2. Does it add, remove or replace a **port**?
3. Does it change data on disk or in the database in a way that needs migration?
4. Does it commit us to a third-party dependency users must download?
5. Would a competent engineer reasonably have chosen differently?
6. Is reversing it more than a day of work?
