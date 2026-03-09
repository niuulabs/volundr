# Components

## Volundr API

The main API server. Built with FastAPI, runs as a multi-worker Uvicorn process.

**Entry points:**

- `volundr` CLI command (or `python -m volundr.main`)
- `uvicorn volundr.main:app` for development

**Responsibilities:**

- Session lifecycle (create, start, stop, delete, archive)
- Workspace provisioning (PVC creation, storage quotas)
- Git integration (repo validation, branch/PR management)
- Chronicle management (session history, timelines)
- Tenant and user management (hierarchy, roles, JIT provisioning)
- Credential and secret management
- Event pipeline (ingest, fan-out to sinks)
- Preset and profile management
- SSE streaming for real-time updates
- Issue tracker integration

## Skuld

WebSocket broker that runs inside each session pod. Connects the web UI to AI coding agents.

**Entry point:** `skuld` CLI command (or `python -m volundr.skuld.broker`)

**Transport modes:**

| Mode | Description |
|------|-------------|
| `sdk` | Long-lived CLI process connected via `--sdk-url` WebSocket (default) |
| `subprocess` | Spawns `claude -p` per message, reads stdout (legacy fallback) |

**Features:**

- Multi-channel support (WebSocket, Telegram)
- In-memory log buffer for pod log retrieval
- Health and readiness endpoints
- Service management for sidecar processes

Skuld has its own configuration (`SkuldSettings`) and is deployed via a separate Helm chart (`charts/skuld/`).

## Hlidskjalf (Web UI)

React single-page application built with Vite.

**Stack:** React, TypeScript, Vite, CSS Modules, design tokens

**Key pages/components:**

- Session management (list, create, start/stop)
- Session chat (WebSocket connection to Skuld)
- Chronicles browser (timeline, diffs, file changes)
- Terminal access (ttyd integration)
- Template browser (workspace blueprints)
- Launch wizard (guided session creation)
- Admin tools (tenant management, credentials)
- Integration management (issue tracker setup)

**Architecture:** follows the same hexagonal pattern — UI has its own `ports/` and `adapters/` directories for API communication, with a store layer for state management.
