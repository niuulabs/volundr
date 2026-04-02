# Spike: Nuitka + FastAPI (NIU-398)

## Goal

Validate that a FastAPI HTTP server starts and serves requests from a
Nuitka `--onefile` binary. Test uvicorn startup, route handling, SSE
streaming, and WebSocket.

## Results

| Capability | Status | Notes |
|---|---|---|
| Uvicorn startup | **Pass** | Starts inside compiled binary |
| GET endpoint | **Pass** | Query params, JSON responses work |
| POST endpoint | **Pass** | Pydantic validation works |
| SSE streaming | **Pass** | `StreamingResponse` + async generators compile correctly |
| WebSocket echo | **Pass** | Upgrade, bidirectional messaging, disconnect handling |

## Required Nuitka Flags

```bash
python -m nuitka \
    --onefile \
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
    --nofollow-import-to=pytest,_pytest \
    __main__.py
```

### Why each flag is needed

- **`uvicorn.*` sub-packages** — Uvicorn dynamically imports protocol
  implementations, lifespan handlers, and loop backends. Nuitka's static
  analysis misses them without explicit includes.
- **`fastapi` + `starlette`** — FastAPI relies on Starlette's routing and
  response machinery, which uses `importlib` internally.
- **`pydantic` + `pydantic_core`** — Pydantic v2 ships a native Rust
  extension (`pydantic_core`). Nuitka bundles `.so`/`.pyd` files in
  `--onefile` mode automatically, but `patchelf >= 0.14` is needed on Linux.
- **`anyio`** — Starlette's async primitives depend on anyio.
- **`websockets`** — Required for the WebSocket protocol layer in uvicorn.

## Known Workarounds

1. **patchelf version** — On some Linux distros the system `patchelf` is
   too old. Install `patchelf >= 0.14` from source or via pip
   (`pip install patchelf`).
2. **`--remove-output`** — Add this flag to clean up the build directory
   after compilation. Omit it during debugging to inspect intermediate files.
3. **`email-validator`** — If using Pydantic's email types, add
   `--include-package=email_validator`.
4. **First-start latency** — The `--onefile` binary extracts to a temp
   directory on first run. Subsequent starts are faster if the cache
   directory persists. Use `--onefile-tempdir-spec` to control the
   extraction location.

## How to Run

```bash
# Development (no compilation)
python -m spikes.nuitka_fastapi

# Build the binary
cd spikes/nuitka_fastapi
bash build.sh

# Run the binary
./nuitka-fastapi-spike

# Test endpoints
curl http://127.0.0.1:8099/health
curl http://127.0.0.1:8099/api/echo?msg=test
curl -X POST http://127.0.0.1:8099/api/reverse \
  -H "Content-Type: application/json" \
  -d '{"text":"hello"}'
curl --no-buffer http://127.0.0.1:8099/api/sse
```

## Conclusion

Nuitka `--onefile` is viable for bundling a FastAPI + uvicorn server. All
tested capabilities (REST, SSE, WebSocket) work correctly. The main
requirement is explicit `--include-package` flags for dynamically imported
modules.
