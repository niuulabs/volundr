#!/bin/bash
set -e

# Tyr Entrypoint Script
# Starts the Tyr saga coordinator service

echo "=== Tyr Saga Coordinator ==="

echo "=== Starting Tyr Service ==="
exec uvicorn tyr.main:app --host 0.0.0.0 --port 8081
