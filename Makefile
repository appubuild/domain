# ---------------------------------------------------------------------------
# Nova Studio — canonical task entry point
#
# Every target here works.  A Makefile that lists commands which do not exist yet
# is worse than no Makefile: it sends a contributor hunting for a script that was
# never written.  Targets are added in the stage that makes them real, so what is
# below is exactly what `make help` promises and nothing more.
#
#   make bootstrap   create the venv and install every dependency
#   make check       run the full local gate (format, lint, types, layering, tests)
#   make doctor      report whether this environment can run Nova Studio
# ---------------------------------------------------------------------------

SHELL           := /bin/bash
.DEFAULT_GOAL   := help
VENV            := .venv
PY              := $(VENV)/bin/python
PIP             := $(VENV)/bin/pip
PYTEST          := $(VENV)/bin/pytest
RUFF            := $(VENV)/bin/ruff
MYPY            := $(VENV)/bin/mypy
# Default test selection excludes anything needing a GPU, model weights or a long
# runtime, so a contributor on a laptop gets a fast green suite (ADR-0016).
PYTEST_DEFAULT  := -m "not (asr or gpu or perf or slow)"
# Backend sources, tests and tooling. Kept in one variable so no target can drift.
SRC             := nova_studio tests scripts

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Run 'make check' before opening a pull request."

$(VENV)/bin/python: ## (internal) create the virtualenv
	python3 -m venv $(VENV)
	$(PIP) install --quiet --upgrade pip setuptools wheel

.PHONY: bootstrap
bootstrap: $(VENV)/bin/python ## Create the venv and install backend + dev dependencies
	$(PIP) install --quiet -r requirements/base.txt
	$(PIP) install --quiet -r requirements/dev.txt
	$(PIP) install --quiet -e . --no-deps
	@echo "backend ready"

.PHONY: bootstrap-asr
bootstrap-asr: $(VENV)/bin/python ## Additionally install the speech-recognition extras
	$(PIP) install --quiet -r requirements/asr.txt
	@echo "ASR extras installed (model weights download on first use)"

.PHONY: doctor
doctor: ## Report whether this environment can run Nova Studio
	$(PY) -m nova_studio doctor

# ---------------------------------------------------------------------------
# Quality gates (ARCHITECTURE.md §13, ADR-0002, ADR-0016)
# ---------------------------------------------------------------------------

.PHONY: format
format: ## Format backend code and apply safe lint fixes
	$(RUFF) format $(SRC)
	$(RUFF) check --fix $(SRC)

.PHONY: lint
lint: ## Lint and verify formatting (must produce zero findings)
	$(RUFF) format --check $(SRC)
	$(RUFF) check $(SRC)

.PHONY: types
types: ## Type-check the backend in strict mode
	$(MYPY)

.PHONY: layering
layering: ## Verify the architectural import rules of ADR-0002
	$(PY) scripts/check_layering.py

.PHONY: layering-explain
layering-explain: ## Print the layering rules, for when a check has just failed
	$(PY) scripts/check_layering.py --explain

.PHONY: hygiene
hygiene: ## Verify no large binaries or generated artefacts are committed
	$(PY) scripts/check_repo_hygiene.py

.PHONY: test
test: ## Run the default test selection (no GPU, no model weights, no long runs)
	$(PYTEST) $(PYTEST_DEFAULT)

.PHONY: test-all
test-all: ## Run every test, including asr, gpu, perf and slow markers
	$(PYTEST)

.PHONY: test-core
test-core: ## Run only the L1 kernel tests
	$(PYTEST) tests/core

.PHONY: serve
serve: ## Run the local API service on an ephemeral loopback port
	$(PY) -m nova_studio serve

.PHONY: smoke
smoke: ## Start the service for real and check that it answers
	$(PYTEST) tests/api -m integration

.PHONY: openapi
openapi: ## Regenerate docs/architecture/api-contract.json from the routes
	$(PY) -m nova_studio openapi --out docs/architecture/api-contract.json

.PHONY: test-cov
test-cov: ## Run tests with a branch-coverage report
	$(PYTEST) $(PYTEST_DEFAULT) --cov=nova_studio --cov-report=term-missing --cov-report=xml

# ---------------------------------------------------------------------------
# Frontend (stage 4)
#
# The frontend owns its own toolchain and lockfile (ADR-0001): npm is the only
# thing this Makefile reaches for, and it reaches for it from frontend/. Nothing
# here installs into the backend venv, and nothing in the venv reaches back.
#
# `contract` is the seam between the two halves. The OpenAPI document is
# generated from the routes, `contract.ts` is generated from the document, and
# `contract-check` fails when either is stale — so a route that changes without
# the frontend hearing about it cannot pass `make check`.
# ---------------------------------------------------------------------------

# Present when node/npm is on this machine, empty otherwise. A backend-only
# contributor is not blocked by a toolchain the backend does not need; CI has
# both, so CI always runs the frontend gates.
NODE := $(shell command -v npm >/dev/null 2>&1 && echo npm)
# Every frontend recipe is run from frontend/, so npm reads that package.json
# and that lockfile and nothing else (ADR-0001).
NPM  := npm
NPNX := npm exec --

.PHONY: contract
contract: ## Generate api-contract.json from the routes, then contract.ts from it
	$(PY) -m nova_studio openapi --out docs/architecture/api-contract.json
	$(PY) scripts/codegen_contract.py

.PHONY: contract-check
contract-check: ## Fail if the committed API contract or generated client is stale
	$(PY) scripts/codegen_contract.py --check
	$(PY) -m nova_studio openapi --check docs/architecture/api-contract.json

frontend/node_modules: frontend/package.json frontend/package-lock.json
	cd frontend && $(NPM) install
	@touch frontend/node_modules

.PHONY: frontend-install
frontend-install: frontend/node_modules ## Install the frontend dependencies

.PHONY: frontend-types
frontend-types: frontend/node_modules ## Type-check the frontend (tsc strict)
	cd frontend && $(NPNX) tsc --noEmit

.PHONY: frontend-lint
frontend-lint: frontend/node_modules ## Lint the frontend and verify formatting
	cd frontend && $(NPNX) eslint .
	cd frontend && $(NPNX) prettier --check .

.PHONY: frontend-format
frontend-format: frontend/node_modules ## Format the frontend and apply safe lint fixes
	cd frontend && $(NPNX) prettier --write .
	cd frontend && $(NPNX) eslint . --fix

.PHONY: frontend-test
frontend-test: frontend/node_modules ## Run the frontend unit and component tests
	cd frontend && $(NPNX) vitest run

.PHONY: frontend-build
frontend-build: frontend/node_modules ## Build the production frontend bundle
	cd frontend && $(NPNX) vite build

.PHONY: frontend-check
frontend-check: contract-check frontend-types frontend-lint frontend-test ## Run every frontend gate

# The host a browser will reach the dev server on, when it is not this machine.
# `make dev DEV_HOST=tablet.local` lets the service accept it (ADR-0005 §4);
# a packaged shell passes nothing and accepts loopback only.
DEV_HOST ?=
# A known port, unlike `make serve`: the dev proxy has to be pointed at it once,
# at start-up, and an ephemeral port would be one the proxy learned too late.
# Something already listening on 8765 is worth hearing about rather than
# working around.
DEV_PORT ?= 8765

.PHONY: dev
dev: frontend/node_modules ## Run the API service and the Vite dev server together
	@mkdir -p .nova
	@echo "the service writes its endpoint (URL and session token) to .nova/dev-endpoint.json"
	@echo "the Vite dev server proxies /api, /ws and /healthz to it and attaches the token"
	$(PY) -m nova_studio serve --port $(DEV_PORT) --endpoint-file .nova/dev-endpoint.json $(if $(DEV_HOST),--allow-host $(DEV_HOST),) & \
	  trap 'kill %1 2>/dev/null' EXIT; \
	  cd frontend && $(NPNX) vite

.PHONY: check
# The frontend gates run where npm exists and are skipped where it does not, so
# a backend-only contributor is never blocked by a toolchain the backend does
# not use. CI always has both, so CI always runs the whole thing.
check: lint types layering hygiene test $(if $(NODE),frontend-check,) ## Run the full local gate before opening a PR
	@echo ""
	@echo "all gates passed"

# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove build and cache artefacts (never touches user data)
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage coverage.xml htmlcov build dist
	find . -type d -name __pycache__ -not -path './$(VENV)/*' -prune -exec rm -rf {} +
	find . -type d -name '*.egg-info' -not -path './$(VENV)/*' -prune -exec rm -rf {} +
	@echo "clean"

.PHONY: distclean
distclean: clean ## Also remove the virtualenv
	rm -rf $(VENV)
	@echo "distclean"

# ---------------------------------------------------------------------------
# Targets that arrive with a later stage
#
# Deliberately absent rather than stubbed. When the stage lands, so does its
# target:
#
#   Stage 5  infra/persist   migrate
#   Stage 8  render engine   bench, goldens
#   Stage 12 api/            smoke
#   Stage 14 packaging       package, package-smoke, desktop
# ---------------------------------------------------------------------------
