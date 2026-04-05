#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Nuitka build script for the FastAPI spike binary.
#
# Prerequisites:
#   pip install nuitka ordered-set zstandard
#   apt-get install -y patchelf  (Linux)  — or  brew install patchelf (macOS)
#
# Flags explained:
#   --onefile               Single-file output (self-extracting archive).
#   --python-flag=-O        Strip asserts in compiled code.
#   --include-package=uvicorn
#                           Uvicorn is imported dynamically by its CLI; Nuitka
#                           misses it without an explicit include.
#   --include-package=uvicorn.lifespan
#                           Lifespan sub-module is loaded at runtime.
#   --include-package=uvicorn.loops
#                           Loop implementations (asyncio/uvloop) loaded at runtime.
#   --include-package=uvicorn.protocols
#                           HTTP + WebSocket protocol implementations.
#   --include-package=fastapi
#                           FastAPI and its route discovery rely on importlib.
#   --include-package=starlette
#                           Starlette internals (routing, responses, middleware).
#   --include-package=pydantic
#                           Pydantic v2 core + plugin discovery.
#   --include-package=anyio
#                           Required by Starlette's async primitives.
#   --include-data-files=...
#                           If any package ships py.typed / JSON schemas, include
#                           them so Pydantic / FastAPI introspection works.
#   --nofollow-import-to=pytest,_pytest
#                           Exclude test frameworks from the binary.
#
# Known workarounds:
#   1. pydantic-core ships a native .so — Nuitka bundles it automatically in
#      --onefile mode, but on some Linux distros you need patchelf >= 0.14.
#   2. If uvicorn fails with "No module named 'uvicorn.protocols.http'",
#      add --include-package=uvicorn.protocols explicitly (already done above).
#   3. SSE streaming works out of the box — StreamingResponse uses async
#      generators which Nuitka compiles correctly.
#   4. WebSocket support requires the 'websockets' or 'wsproto' package to
#      be installed. Nuitka finds it via --include-package=websockets.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_NAME="nuitka-fastapi-spike"

echo "==> Building ${OUTPUT_NAME} with Nuitka --onefile"

python -m nuitka \
    --onefile \
    --python-flag=-O \
    --output-filename="${OUTPUT_NAME}" \
    --include-package=uvicorn \
    --include-package=uvicorn.lifespan \
    --include-package=uvicorn.loops \
    --include-package=uvicorn.protocols \
    --include-package=fastapi \
    --include-package=starlette \
    --include-package=pydantic \
    --include-package=pydantic_core \
    --include-package=anyio \
    --include-package=websockets \
    --include-package=email_validator \
    --nofollow-import-to=pytest,_pytest \
    --remove-output \
    "${SCRIPT_DIR}/__main__.py"

echo "==> Build complete: ./${OUTPUT_NAME}"
echo "    Run with: ./${OUTPUT_NAME}"
echo "    Test with:"
echo "      curl http://127.0.0.1:8099/health"
echo "      curl http://127.0.0.1:8099/api/echo?msg=nuitka"
echo '      curl -X POST http://127.0.0.1:8099/api/reverse -H "Content-Type: application/json" -d '"'"'{"text":"hello"}'"'"
echo "      curl --no-buffer http://127.0.0.1:8099/api/sse"
echo "      python -c \"import asyncio, websockets; asyncio.run(websockets.connect('ws://127.0.0.1:8099/ws/echo'))\""
