# Niuu single-binary build pipeline
#
# Targets:
#   make build-web      — build React SPA, copy into src/cli/web/dist/
#   make build-postgres — compile PostgreSQL + pgvector from source
#   make build-cli      — Nuitka --onefile compilation → dist/niuu
#   make build          — all of the above
#
# Parameters (for future binary targets):
#   BINARY_NAME  — output binary name       (default: niuu)
#   ENTRY_POINT  — Python entry point file   (default: src/cli/__main__.py)

BINARY_NAME  ?= niuu
ENTRY_POINT  ?= src/cli/__main__.py
OUTPUT_DIR   ?= dist
WEB_DIR      := web
WEB_DEST     := src/cli/web/dist
MIG_DIR      := migrations
MIG_DEST     := src/cli/migrations/volundr
TYR_MIG_DEST := src/cli/migrations/tyr

# PostgreSQL build — versions read from the single source of truth
PG_VERSIONS_PY := src/niuu/pg_versions.py
POSTGRES_VERSION := $(shell python3 -c "exec(open('$(PG_VERSIONS_PY)').read()); print(POSTGRES_VERSION)")
PGVECTOR_VERSION := $(shell python3 -c "exec(open('$(PG_VERSIONS_PY)').read()); print(PGVECTOR_VERSION)")
PGINSTALL_DIR    := build/pginstall

.PHONY: build build-web build-postgres build-cli copy-migrations clean lint test verify

# --------------------------------------------------------------------------
# Full build: web assets → migrations → PostgreSQL → Nuitka binary
# --------------------------------------------------------------------------
build: build-web copy-migrations build-postgres build-cli

# --------------------------------------------------------------------------
# Web UI: npm build + copy dist/ into the cli package data directory
# --------------------------------------------------------------------------
build-web:
	cd $(WEB_DIR) && npm ci --ignore-scripts && npm run build
	rm -rf $(WEB_DEST)
	cp -r $(WEB_DIR)/dist $(WEB_DEST)

# --------------------------------------------------------------------------
# PostgreSQL + pgvector: compile from source into build/pginstall/
# --------------------------------------------------------------------------
build-postgres:
	POSTGRES_VERSION=$(POSTGRES_VERSION) \
	PGVECTOR_VERSION=$(PGVECTOR_VERSION) \
	INSTALL_PREFIX=$(PGINSTALL_DIR) \
	scripts/build_postgres.sh

# --------------------------------------------------------------------------
# Migrations: copy SQL files into the cli package data directory
# --------------------------------------------------------------------------
copy-migrations:
	rm -rf $(MIG_DEST)/*.sql $(TYR_MIG_DEST)/*.sql
	mkdir -p $(MIG_DEST) $(TYR_MIG_DEST)
	cp $(MIG_DIR)/*.up.sql $(MIG_DEST)/
	cp $(MIG_DIR)/tyr/*.up.sql $(TYR_MIG_DEST)/

# --------------------------------------------------------------------------
# Nuitka single-binary compilation
# --------------------------------------------------------------------------
build-cli:
	uv run python -m cli.build \
		--name $(BINARY_NAME) \
		--entry $(ENTRY_POINT) \
		--output-dir $(OUTPUT_DIR)

# --------------------------------------------------------------------------
# Quality gates
# --------------------------------------------------------------------------
lint:
	uv run ruff check src/ tests/
	uv run ruff format --check src/ tests/

test:
	uv run pytest tests/ -v --tb=short

verify: lint test

# --------------------------------------------------------------------------
# Cleanup
# --------------------------------------------------------------------------
clean:
	rm -rf $(OUTPUT_DIR) $(WEB_DEST) build/ *.build/ *.dist/ *.onefile-build/
	rm -rf $(MIG_DEST)/*.sql $(TYR_MIG_DEST)/*.sql
	rm -rf $(PGINSTALL_DIR)
