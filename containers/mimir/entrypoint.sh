#!/bin/bash
set -e

# Mimir Entrypoint Script
# Starts the Mimir standalone knowledge service

echo "=== Mimir Knowledge Service ==="

exec python -m mimir "$@"
