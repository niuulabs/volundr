#!/bin/bash
set -e

# Volundr Entrypoint Script
# Starts the Volundr session manager service

echo "=== Volundr Session Manager ==="

# Configure API endpoint
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Using Anthropic API"
    export ANTHROPIC_API_KEY
fi

if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo "Using custom API endpoint: $ANTHROPIC_BASE_URL"
    export ANTHROPIC_BASE_URL
    export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-}"
fi

echo "=== Starting Volundr Service ==="
exec uvicorn volundr.main:app --host 0.0.0.0 --port 8080
