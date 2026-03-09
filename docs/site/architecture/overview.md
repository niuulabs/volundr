# Architecture Overview

Volundr follows hexagonal architecture. Business logic lives in the domain layer and communicates with infrastructure through port interfaces. Adapters implement those interfaces.

## System architecture

```
                    ┌──────────────────────┐
                    │    Hlidskjalf UI     │
                    │   (React / Vite)     │
                    └─────────┬────────────┘
                              │ REST + SSE
                              ▼
                    ┌──────────────────────┐
                    │    Volundr API       │
                    │    (FastAPI)         │
                    │                      │
                    │  Sessions, Profiles, │
                    │  Chronicles, Git,    │
                    │  Tenants, Events     │
                    └──┬─────┬─────┬──────┘
                       │     │     │
            ┌──────────┘     │     └──────────┐
            ▼                ▼                ▼
     ┌────────────┐  ┌────────────┐   ┌────────────┐
     │ PostgreSQL │  │ Kubernetes │   │ Git APIs   │
     │            │  │  (pods)    │   │ (GH/GL)    │
     └────────────┘  └─────┬──────┘   └────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Skuld   │ │  Code    │ │ Terminal │
        │ (broker) │ │  Server  │ │  (ttyd)  │
        └──────────┘ └──────────┘ └──────────┘
              │
              │ WebSocket
              ▼
        AI Coding Agent
```

## Data flow

1. User creates a session through the UI or API
2. Volundr validates the request, provisions a workspace PVC, and calls the pod manager
3. The pod manager launches a pod group: Skuld broker + Code Server + terminal
4. All pods share a workspace PVC at the session path
5. The UI connects to Skuld via WebSocket for chat — Volundr is not in the chat data path
6. Session events (messages, file changes, git operations) flow through the event pipeline to configured sinks
7. When the session stops, a chronicle is auto-created with a timeline of events

## Key design decisions

- **Raw SQL via asyncpg** — no ORM. Queries are explicit and parameterized.
- **Dynamic adapter loading** — adapters are specified as fully-qualified class paths in YAML config. Adding a new adapter means writing a class and updating config — no code changes in the container.
- **Ports over mocks** — business logic depends only on abstract port interfaces, making it testable without infrastructure.
- **CSI-based secrets** — Volundr never sees secret values. It generates pod spec additions that tell the CSI driver what to mount.
- **Config-driven profiles/templates** — loaded from YAML or CRDs, not stored in the database. Presets (DB-stored) handle user-customizable runtime config.
