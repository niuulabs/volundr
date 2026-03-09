#!/bin/bash
set -e

# Skuld Entrypoint Script
# Prepares the workspace and starts the broker service

echo "==== Skuld Entrypoint ===="
echo "Session ID: ${SESSION_ID:-unknown}"
echo "Workspace: ${WORKSPACE_DIR:-/volundr/sessions/${SESSION_ID}/workspace}"

# Set defaults
export SESSION_ID="${SESSION_ID:-unknown}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/volundr/sessions/${SESSION_ID}/workspace}"

# Create workspace directory if it doesn't exist
mkdir -p "$WORKSPACE_DIR"

# Configure Claude Code CLI based on provider
# Anthropic API (default)
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Using Anthropic API"
    export ANTHROPIC_API_KEY
fi

# Ollama or compatible API
if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo "Using custom API endpoint: $ANTHROPIC_BASE_URL"
    export ANTHROPIC_BASE_URL
    export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-}"
fi

# Set up Claude Code configuration directory
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$WORKSPACE_DIR/.claude}"
mkdir -p "$CLAUDE_CONFIG_DIR"

echo "=== Starting Broker Service (port 8081) ==="
exec python -m volundr.skuld
