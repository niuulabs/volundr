#!/bin/bash
# Setup pre-commit hooks and required tooling.
# This runs at the start of each Claude session.

set -e

cd "$CLAUDE_PROJECT_DIR"

# Use python -m pre_commit to avoid PATH issues with pip-installed binaries
_pre_commit() {
    python -m pre_commit "$@"
}

# ── Tool installation ─────────────────────────────────────────────

# pre-commit framework
if ! python -c "import pre_commit" &> /dev/null; then
    echo "Installing pre-commit..."
    pip install pre-commit==4.5.1 --quiet
fi

# ruff (Python linter + formatter) — version pinned for reproducibility
if ! command -v ruff &> /dev/null; then
    echo "Installing ruff..."
    pip install ruff==0.11.2 --quiet
fi

# trufflehog (secret scanner) — pinned to specific release, not main branch
if ! command -v trufflehog &> /dev/null; then
    echo "Installing trufflehog..."
    TRUFFLEHOG_VERSION="v3.88.1"
    TRUFFLEHOG_BIN="${GOPATH:-$HOME/go}/bin"
    curl -sSfL "https://raw.githubusercontent.com/trufflesecurity/trufflehog/${TRUFFLEHOG_VERSION}/scripts/install.sh" \
        | sh -s -- -b "$TRUFFLEHOG_BIN" "${TRUFFLEHOG_VERSION}"
fi

# web dependencies (prettier, eslint)
if [ -d "web" ] && [ ! -d "web/node_modules" ]; then
    echo "Installing web dependencies..."
    (cd web && npm ci --ignore-scripts --quiet)
fi

# ── Hook installation ─────────────────────────────────────────────

if [ ! -f ".git/hooks/pre-commit" ] || ! grep -q "pre-commit" ".git/hooks/pre-commit" 2>/dev/null; then
    echo "Installing pre-commit hooks..."
    _pre_commit install --install-hooks
    echo "Pre-commit hooks installed successfully"
else
    echo "Pre-commit hooks already installed"
fi
