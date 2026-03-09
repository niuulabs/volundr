#!/bin/bash
set -e

# Skuld-Codex Entrypoint Script
# Prepares the workspace and starts the broker service

echo "==== Skuld-Codex Entrypoint ===="
echo "Session ID: ${SESSION_ID:-unknown}"
echo "Workspace: ${WORKSPACE_DIR:-/volundr/sessions/${SESSION_ID}/workspace}"

# Set defaults
export SESSION_ID="${SESSION_ID:-unknown}"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/volundr/sessions/${SESSION_ID}/workspace}"

# Create workspace directory if it doesn't exist
mkdir -p "$WORKSPACE_DIR"

# OpenAI API key
if [ -n "$OPENAI_API_KEY" ]; then
    echo "Using OpenAI API"
    export OPENAI_API_KEY
fi

echo "=== Starting Broker Service (port 8081) ==="
exec python -m volundr.skuld
