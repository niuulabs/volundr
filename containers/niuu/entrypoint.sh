#!/bin/bash
set -e

# Niuu Entrypoint Script
# Starts the Niuu shared platform services

echo "=== Niuu Shared Services ==="

echo "=== Starting Niuu Service ==="
exec uvicorn niuu.main:app --host 0.0.0.0 --port 8082
