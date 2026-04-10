#!/bin/bash
set -e
echo "=== Bifrost LLM Gateway ==="
exec python -m bifrost "$@"
