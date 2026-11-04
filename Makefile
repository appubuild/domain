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

.PHONY: test-cov
test-cov: ## Run tests with a branch-coverage report
	$(PYTEST) $(PYTEST_DEFAULT) --cov=nova_studio --cov-report=term-missing --cov-report=xml

.PHONY: check
check: lint types layering hygiene test ## Run the full local gate before opening a PR
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
#   Stage 4  frontend/       frontend-types, frontend-lint, frontend-test,
#                            frontend-build, dev
#   Stage 5  infra/persist   migrate
#   Stage 8  render engine   bench, goldens
#   Stage 12 api/            serve, smoke, openapi
#   Stage 14 packaging       package, package-smoke, desktop
# ---------------------------------------------------------------------------
