#!/bin/bash
# Setup pre-commit hooks if not already installed
# This runs at the start of each Claude session

set -e

cd "$CLAUDE_PROJECT_DIR"

# Check if pre-commit is installed
if ! command -v pre-commit &> /dev/null; then
    echo "Installing pre-commit..."
    pip install pre-commit --quiet
fi

# Check if hooks are installed in the repo
if [ ! -f ".git/hooks/pre-commit" ] || ! grep -q "pre-commit" ".git/hooks/pre-commit" 2>/dev/null; then
    echo "Installing pre-commit hooks..."
    pre-commit install --install-hooks
    echo "Pre-commit hooks installed successfully"
else
    echo "Pre-commit hooks already installed"
fi
