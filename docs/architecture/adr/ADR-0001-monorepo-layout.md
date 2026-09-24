# ADR-0001 — Monorepo layout with `src`-style Python package

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

Nova Studio ships as one product built from at least four toolchains: Python (core
service), TypeScript/React (UI), a native desktop shell, and a packaging pipeline. Two
questions must be answered before any code is written:

1. One repository or many?
2. Where does the Python package live relative to the repo root?

A multi-repo setup would require version pinning between the API contract and the frontend
client, and would make an atomic change (backend DTO + frontend type + test) impossible.
The API contract is the tightest coupling in the system.

Placing `pyproject.toml` beside the importable package at the repo root (flat layout) makes
it trivially easy to `import nova_studio` from the repository root without installing it —
which means tests can silently exercise the working tree instead of the installed
distribution, and packaging bugs (missing `package-data`, wrong `find` config) surface only
in the shipped EXE.

## Decision

**Single monorepo**, laid out as:

```
domain/                          repository root
├── pyproject.toml               Python build/lint/type/test configuration
├── nova_studio/                 the importable Python package (L1–L4)
├── frontend/                    React + TypeScript app (own package.json)
├── apps/desktop/                pywebview shell + PyInstaller packaging
├── docs/                        architecture, guides, API reference
├── scripts/                     dev, packaging, benchmark, codegen utilities
├── tests/                       Python test suite (mirrors nova_studio/)
├── requirements/                pinned lockfiles per platform
└── Makefile                     canonical task entry point
```

* `tests/` is **outside** `nova_studio/` so it is never shipped in the wheel or the EXE.
* `frontend/` owns its own lockfile and never imports Python-generated JS at build time
  except through the explicit contract codegen step (`scripts/codegen_contract.py`).
* `apps/desktop/` depends on both artefacts but contains no business logic.
* Generated media fixtures are created on demand into `pytest` tmp dirs — never committed
  (ADR-0016).

## Consequences

**Positive**

* One atomic commit spans backend, contract, frontend and tests.
* One CI pipeline, one issue tracker, one release train.
* `docs/` sits next to the code it describes, so review can require doc updates.

**Negative / accepted**

* The repo is large for a fresh clone; mitigated by never committing binaries or models.
* Contributors need two toolchains installed; mitigated by `make bootstrap` and a
  documented minimal path (`make backend-dev` works without Node).
* Python must be installed (`pip install -e .`) for tests to import the package correctly;
  enforced by CI always running from an installed editable wheel.

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Polyrepo (backend / frontend / desktop) | Contract drift; no atomic changes; three release trains for one product |
| Flat layout (`pyproject.toml` beside package, tests inside package) | Accidental import of the working tree; test code shipped to users |
| `src/nova_studio/` layout | Functionally equivalent to what we chose; rejected only because the repo root already carries `frontend/` and `apps/`, so an extra `src/` level adds depth without adding isolation. The isolation benefit is obtained by requiring editable install in CI. |
| Nx/Turborepo monorepo tooling | Adds a JS-centric build graph over a Python-majority repo; not worth the dependency |
