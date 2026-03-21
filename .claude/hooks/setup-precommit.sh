#!/bin/bash
# Setup pre-commit hooks if not already installed
# This runs at the start of each Claude session

set -e

cd "$CLAUDE_PROJECT_DIR"

# Use python -m pre_commit to avoid PATH issues with pip-installed binaries
_pre_commit() {
    python -m pre_commit "$@"
}

# Check if pre-commit module is available
if ! python -c "import pre_commit" &> /dev/null; then
    echo "Installing pre-commit..."
    pip install pre-commit==4.5.1 --quiet
fi

# Check if hooks are installed in the repo
if [ ! -f ".git/hooks/pre-commit" ] || ! grep -q "pre-commit" ".git/hooks/pre-commit" 2>/dev/null; then
    echo "Installing pre-commit hooks..."
    _pre_commit install --install-hooks
    echo "Pre-commit hooks installed successfully"
else
    echo "Pre-commit hooks already installed"
fi
