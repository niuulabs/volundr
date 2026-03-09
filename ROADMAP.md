# Völundr Implementation Roadmap
## The Forge — Claude Code Session Management

> **Status**: All phases complete. Full test coverage (88%+). Ready for production.

---

## Overview

Völundr is a self-hosted Claude Code session manager. Users create sessions, pick a model, and get a persistent coding environment with chat, terminal, and VS Code access.

**Tech Stack**
- Python / FastAPI
- Hexagonal architecture with adapter pattern
- PostgreSQL (raw SQL, no ORM)
- Farm (ITaaS) for session orchestration

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          VÖLUNDR                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Hlidskjalf UI ──────► Volundr (API) ───────► Farm (ITaaS)    │
│      ✅ DONE                🔨 WIP                ✅ DONE       │
│                                 │                               │
│                                 │     Flux/Fleet + Helm         │
│                                 │                               │
│                ┌────────────────┼────────────────┐              │
│                ▼                ▼                ▼              │
│          ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│          │  SKULD   │    │  CODE    │    │ TERMINAL │          │
│          │   POD    │    │ SERVER   │    │   POD    │          │
│          │          │    │   POD    │    │          │          │
│          │ Claude   │    │ VS Code  │    │  ttyd    │          │
│          │ Code CLI │    │          │    │          │          │
│          │ +Broker  │    │          │    │          │          │
│          └────┬─────┘    └────┬─────┘    └────┬─────┘          │
│               │               │               │                 │
│               └───────────────┴───────────────┘                 │
│                               │                                 │
│                   Shared Storage (RWX PVC)                      │
│                   /volundr/sessions/{uuid}/                     │
│                   ├── .claude/                                  │
│                   └── workspace/                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hexagonal Architecture

```
INBOUND ADAPTERS          CORE DOMAIN              OUTBOUND ADAPTERS
(Driving)                 (Ports & Services)       (Driven)

┌─────────────┐          ┌─────────────────┐      ┌─────────────────┐
│ REST API    │─────────►│ SessionService  │─────►│ PostgreSQL      │
│ (FastAPI)   │          │                 │      │ Adapter         │
└─────────────┘          │                 │      └─────────────────┘
                         │                 │
                         │                 │      ┌─────────────────┐
                         │                 │─────►│ Farm Adapter    │
                         │                 │      │ (ITaaS API)     │
                         └─────────────────┘      └─────────────────┘
                                 │
                         ┌───────┴───────┐
                         ▼               ▼
                ┌─────────────┐  ┌─────────────────┐
                │StatsService │  │ GitProvider     │
                │             │  │ (GitHub/GitLab) │
                └─────────────┘  └─────────────────┘
```

**Ports (Interfaces)**
- `SessionRepository` — database operations for sessions
- `PodManager` — Farm ITaaS API (launches Helm-based sessions)
- `StatsRepository` — aggregate statistics queries
- `TokenTracker` — token usage recording and retrieval
- `GitProvider` — git repository validation and credential handling
- `PricingProvider` — model pricing lookup (adapter pattern for future flexibility)

**Direct Egress for Chat**

Chat WebSocket traffic goes directly to Skuld pods via ingress — Volundr API is not in the data path:

```
UI ──WS──► Ingress ──► Skuld Pod (direct)
        │
        └── Volundr only for lifecycle/CRUD
```

Volundr returns the chat endpoint URL when starting a session. UI connects directly.

---

## Hlidskjalf UI Integration

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token reporting | API endpoint callable from Skuld pods | Simple HTTP POST, no message queue needed |
| Git credentials | Kubernetes secrets | Standard k8s pattern, works with sealed-secrets |
| Model pricing | Hardcoded with adapter pattern | Simple now, swappable later |
| Backward compatibility | Breaking changes allowed | Clean slate, no legacy data |

---

## Implementation Phases

### Phase 1: Core Session Schema Extensions ✅ COMPLETE
**Priority**: HIGH — Required for basic UI functionality

#### 1.1 Domain Model Changes
**File:** `src/volundr/domain/models.py`

- [x] Add `repo: str` field (required, 1-500 chars)
- [x] Add `branch: str` field (required, 1-255 chars)
- [x] Add `last_active: datetime` field (defaults to `created_at`)
- [x] Add `message_count: int` field (default 0)
- [x] Add `tokens_used: int` field (default 0)
- [x] Add `pod_name: str | None` field (nullable)
- [x] Add `error: str | None` field (nullable)
- [x] Add `with_error(error: str)` method for setting error state
- [x] Add `with_activity(message_count: int, tokens: int)` method

#### 1.2 Database Schema Changes
**File:** `src/volundr/infrastructure/database.py`

- [x] Add `repo VARCHAR(500) NOT NULL` column
- [x] Add `branch VARCHAR(255) NOT NULL` column
- [x] Add `last_active TIMESTAMP WITH TIME ZONE NOT NULL` column
- [x] Add `message_count INTEGER NOT NULL DEFAULT 0` column
- [x] Add `tokens_used INTEGER NOT NULL DEFAULT 0` column
- [x] Add `pod_name VARCHAR(255)` nullable column
- [x] Add `error TEXT` nullable column
- [x] Add index on `last_active` for sorting

#### 1.3 PostgreSQL Adapter Updates
**File:** `src/volundr/adapters/outbound/postgres.py`

- [x] Update `create()` INSERT to include new fields
- [x] Update `update()` UPDATE to include new fields
- [x] Update `_row_to_session()` to map new columns

#### 1.4 REST API Schema Updates
**File:** `src/volundr/adapters/inbound/rest.py`

- [x] Add `repo` and `branch` to `SessionCreate`
- [x] Add `branch` to `SessionUpdate` (repo not updatable)
- [x] Add all new fields to `SessionResponse`
- [x] Update `SessionResponse.from_session()` mapping

#### 1.5 Service Layer Updates
**File:** `src/volundr/domain/services.py`

- [x] Update `create_session()` to accept `repo` and `branch` params
- [x] Update `update_session()` to accept `branch` param
- [x] Add `record_activity()` method for incrementing message_count/tokens
- [x] Update `start_session()` to capture `pod_name` from PodManager
- [x] Update failure handling to capture error message

#### 1.6 Port Interface Updates
**File:** `src/volundr/domain/ports.py`

- [x] Create `PodStartResult` dataclass with `chat_endpoint`, `code_endpoint`, `pod_name`
- [x] Update `PodManager.start()` return type to `PodStartResult`

---

### Phase 2: Statistics Endpoint ✅ COMPLETE
**Priority**: HIGH — Required for dashboard metrics

#### 2.1 Domain Models
**File:** `src/volundr/domain/models.py`

- [x] Create `Stats` dataclass with all stats fields
- [x] Add `ModelProvider` enum (`CLOUD`, `LOCAL`)

#### 2.2 Port Interface for Stats
**File:** `src/volundr/domain/ports.py`

- [x] Create `StatsRepository` port interface
- [x] Define `get_stats() -> Stats` method signature

#### 2.3 Database Schema for Token Tracking
**File:** `src/volundr/infrastructure/database.py`

- [x] Create `token_usage` table:
  ```sql
  CREATE TABLE token_usage (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      tokens INTEGER NOT NULL,
      provider VARCHAR(20) NOT NULL,  -- 'cloud' or 'local'
      model VARCHAR(100) NOT NULL,
      cost NUMERIC(10, 6)  -- USD, nullable for local
  );
  ```
- [x] Add indexes for date-based aggregation queries
- [x] Add index on session_id for lookups

#### 2.4 PostgreSQL Stats Adapter
**New File:** `src/volundr/adapters/outbound/postgres_stats.py`

- [x] Implement `PostgresStatsRepository`
- [x] Query for `active_sessions` (status = 'running')
- [x] Query for `total_sessions`
- [x] Aggregation query for `tokens_today` with UTC date filter
- [x] Aggregation query split by `local_tokens` / `cloud_tokens`
- [x] Calculate `cost_today` from token_usage table

#### 2.5 Stats Service
**File:** `src/volundr/domain/services.py`

- [x] Create `StatsService` class
- [x] Implement `get_stats()` method

#### 2.6 REST Endpoint
**File:** `src/volundr/adapters/inbound/rest.py`

- [x] Create `StatsResponse` Pydantic model
- [x] Add `GET /api/v1/volundr/stats` endpoint
- [x] Wire up `StatsService` dependency

---

### Phase 3: Token Reporting API ✅ COMPLETE
**Priority**: HIGH — Required for Skuld pods to report usage

#### 3.1 Token Tracker Port
**File:** `src/volundr/domain/ports.py`

- [x] Create `TokenTracker` port interface
- [x] Define `record_usage(session_id, tokens, provider, model, cost)` method
- [x] Define `get_session_usage(session_id) -> int` method

#### 3.2 PostgreSQL Token Tracker
**New File:** `src/volundr/adapters/outbound/postgres_tokens.py`

- [x] Implement `PostgresTokenTracker`
- [x] Insert into `token_usage` table
- [x] Update session `tokens_used`, `message_count`, and `last_active`
- [x] Transaction to ensure atomicity

#### 3.3 REST Endpoint for Token Reporting
**File:** `src/volundr/adapters/inbound/rest.py`

- [x] Create `TokenUsageReport` request model:
  ```python
  class TokenUsageReport(BaseModel):
      tokens: int
      provider: Literal["cloud", "local"]
      model: str
      message_count: int = 1
  ```
- [x] Add `POST /api/v1/volundr/sessions/{session_id}/usage` endpoint
- [x] Validate session exists and is running
- [x] Calculate cost based on model pricing

---

### Phase 4: Model Schema Extensions ✅ COMPLETE
**Priority**: MEDIUM — Improves UX with rich model selection

#### 4.1 Domain Models
**File:** `src/volundr/domain/models.py`

- [x] Create `ModelProvider` enum (`CLOUD`, `LOCAL`) — already existed from Phase 2
- [x] Create `ModelTier` enum (`FRONTIER`, `BALANCED`, `EXECUTION`, `REASONING`)
- [x] Create `Model` domain model with extended fields

#### 4.2 Pricing Provider Port (Adapter Pattern)
**File:** `src/volundr/domain/ports.py`

- [x] Create `PricingProvider` port interface
- [x] Define `get_price(model_id: str) -> float | None` method
- [x] Define `list_models() -> list[Model]` method

#### 4.3 Hardcoded Pricing Adapter
**New File:** `src/volundr/adapters/outbound/pricing.py`

- [x] Implement `HardcodedPricingProvider`
- [x] Define pricing for Claude models:
  ```python
  PRICING = {
      "claude-opus-4-20250514": 15.00,      # per million tokens
      "claude-sonnet-4-20250514": 3.00,
      "claude-3-5-haiku-20241022": 0.25,
  }
  ```
- [x] Return `None` for local models (free)

#### 4.4 Model Configuration
**File:** `src/volundr/adapters/outbound/pricing.py`

- [x] Add model metadata with MODELS list
- [x] Include local models (Ollama) with VRAM requirements

#### 4.5 REST Schema Updates
**File:** `src/volundr/adapters/inbound/rest.py`

- [x] Extend `ModelInfo` with `provider`, `tier`, `color`
- [x] Add `cost_per_million_tokens` (nullable for local)
- [x] Add `vram_required` (nullable for cloud)
- [x] Update endpoint to fetch from `PricingProvider`

---

### Phase 5: Git Provider Integration ✅ COMPLETE
**Priority**: MEDIUM — Required for repository cloning

#### 5.1 Git Provider Abstraction
**File:** `src/volundr/domain/ports.py`

- [x] Create `GitProvider` port interface
- [x] Define `validate_repo(repo: str) -> bool` method
- [x] Define `get_clone_url(repo: str) -> str` method (with embedded credentials)
- [x] Define `parse_repo(repo: str) -> RepoInfo` method
- [x] Define `list_repos(org: str) -> list[RepoInfo]` method

#### 5.2 Git Provider Domain Models
**File:** `src/volundr/domain/models.py`

- [x] Create `GitProviderType` enum (`GITHUB`, `GITLAB`, `BITBUCKET`, `GENERIC`)
- [x] Create `RepoInfo` model (provider, org, name, clone_url, url)

#### 5.3 GitHub Adapter
**New File:** `src/volundr/adapters/outbound/github.py`

- [x] Implement `GitHubProvider` adapter
- [x] Read credentials from k8s secret (via env var)
- [x] Support PAT authentication
- [x] Generate clone URL: `https://x-access-token:{token}@github.com/{org}/{repo}.git`
- [x] Implement repo validation via GitHub API
- [x] Implement list_repos for org/user

#### 5.4 GitLab Adapter
**New File:** `src/volundr/adapters/outbound/gitlab.py`

- [x] Implement `GitLabProvider` adapter
- [x] Support Personal Access Token auth
- [x] Support self-hosted GitLab instances (configurable base URL)
- [x] Support multiple GitLab instances simultaneously
- [x] Generate clone URL: `https://oauth2:{token}@{host}/{org}/{repo}.git`
- [x] Implement repo validation via GitLab API
- [x] Implement list_repos for group/user

#### 5.5 Git Provider Registry
**New File:** `src/volundr/adapters/outbound/git_registry.py`

- [x] Create `GitProviderRegistry` to manage multiple providers
- [x] Auto-detect provider based on repo URL pattern
- [x] Support multiple providers (GitHub + GitLab) simultaneously
- [x] Support multiple instances of same provider type
- [x] Aggregate operations (list_repos, validate) across providers

#### 5.6 Configuration
**File:** `src/volundr/config.py`

- [x] Add `GitHubConfig` with token and base_url
- [x] Add `GitLabInstance` dataclass for instance config
- [x] Add `GitLabConfig` with JSON support for multiple instances:
  ```bash
  GITHUB_TOKEN=ghp_xxx
  GITLAB_TOKEN=glpat-xxx  # Default gitlab.com
  GITLAB_INSTANCES='[{"name": "Internal", "base_url": "https://git.company.com", "token": "xxx"}]'
  ```
- [x] Add `GitConfig` with validate_on_create flag

#### 5.7 Session Service Integration
**File:** `src/volundr/domain/services.py`

- [x] Inject `GitProviderRegistry` into `SessionService`
- [x] Add `RepoValidationError` exception
- [x] Validate repo exists on session creation (configurable)
- [x] Add `get_clone_url()` method for authenticated clone URLs
- [x] Handle repo validation errors in REST adapter

---

### Phase 6: Farm/Pod Manager Updates ✅ COMPLETE
**Priority**: MEDIUM — Required for full session lifecycle

#### 6.1 Enhanced Start Response
**File:** `src/volundr/adapters/outbound/farm.py`

- [x] Extract `pod_name` from Farm task response
- [x] Pass repo URL and branch to Farm task payload
- [x] Include git credentials via `env_from` (Kubernetes secret mounting)

#### 6.2 Session Start Payload
- [x] Update Farm task submission to include git args:
  ```json
  {
    "task_type": "skuld",
    "task_args": {
      "session": { "id": "uuid", "model": "...", "name": "..." },
      "git": {
        "repo_url": "https://github.com/org/repo",
        "branch": "main"
      }
    },
    "env_from": [
      { "secretRef": { "name": "github-credentials" } },
      { "secretRef": { "name": "gitlab-credentials" } }
    ]
  }
  ```

**Note:** Credentials are NOT embedded in the repo URL. Instead, they are mounted
via `env_from` from Kubernetes secrets (configured via `FARM_GIT_SECRET_NAMES`).
Supports multiple secrets for different providers (GitHub, GitLab, enterprise, etc.).

#### 6.3 Port Interface Updates
**File:** `src/volundr/domain/ports.py`

- [x] Add optional `clone_url` parameter to `PodManager.start()` signature

#### 6.4 Service Integration
**File:** `src/volundr/domain/services.py`

- [x] Update `start_session()` to get clone URL from git registry (for triggering git args)
- [x] Pass clone URL to pod manager when starting session

#### 6.5 Configuration
**File:** `src/volundr/config.py`

- [x] Add `git_secret_names` (list) to `FarmConfig` for multiple Kubernetes secret references

---

### Phase 7: Real-time Updates ✅
**Priority**: LOW — UI uses polling as fallback
**Status**: COMPLETED

#### 7.1 WebSocket Support (Option A)
- [ ] Add WebSocket endpoint `WS /ws/sessions` *(deferred - SSE chosen instead)*
- [ ] Implement connection manager *(deferred)*
- [ ] Broadcast session updates to connected clients *(deferred)*
- [ ] Broadcast stats updates periodically *(deferred)*

#### 7.2 Server-Sent Events (Option B) ✅
- [x] Add SSE endpoint `GET /api/v1/volundr/sessions/stream`
- [x] Stream session changes as events
- [x] Include stats in periodic heartbeat

#### 7.3 Event Broadcasting Infrastructure ✅
- [x] Add `EventBroadcaster` port interface
- [x] Add `EventType` and `RealtimeEvent` domain models
- [x] Implement `InMemoryEventBroadcaster` adapter
- [x] Integrate broadcaster with `SessionService` for session events
- [x] Integrate broadcaster with `TokenService` for usage events
- [x] Add background task for periodic stats/heartbeat broadcasts
- [x] Add comprehensive unit tests for broadcaster
- [x] Add service integration tests for event publishing

---

### Phase 8: Testing ✅ COMPLETE
**Priority**: HIGH — Continuous throughout implementation
**Status**: 586 tests passing, 88.52% coverage

#### 8.1 Unit Tests
- [x] Update `InMemorySessionRepository` fixture for new fields
- [x] Add tests for new domain model fields and methods
- [x] Add tests for `StatsService`
- [x] Add tests for `TokenTracker`
- [x] Add tests for Git provider parsing
- [x] Add tests for pricing provider

#### 8.2 Integration Tests
- [x] Test new REST endpoint fields
- [x] Test `/stats` endpoint
- [x] Test `/sessions/{id}/usage` endpoint
- [x] Test session create with repo/branch
- [x] Test session update with branch change

#### 8.3 Coverage Requirements
- [x] Maintain minimum 85% code coverage (actual: 88.52%)
- [x] Zero pytest warnings

---

## Dependencies Graph

```
Phase 1 (Session Schema) ─────┬──────────────────────────────┐
         │                    │                              │
         ▼                    ▼                              ▼
Phase 2 (Stats)         Phase 3 (Token API)          Phase 4 (Models)
         │                    │                              │
         └────────────────────┼──────────────────────────────┘
                              │
                              ▼
                    Phase 5 (Git Providers)
                              │
                              ▼
                    Phase 6 (Farm Updates)
                              │
                              ▼
                    Phase 7 (Real-time) [Optional]
                              │
                              ▼
                    Phase 8 (Testing) [Continuous]
```

---

## Implementation Order (Sprints)

### Sprint 1: MVP Integration
1. **Phase 1**: Core session schema changes (all layers)
2. **Phase 8.1**: Update test fixtures and domain tests

### Sprint 2: Statistics & Token Tracking
3. **Phase 2**: Statistics endpoint
4. **Phase 3**: Token reporting API
5. **Phase 8.1**: Stats and token tracker tests

### Sprint 3: Models & Git
6. **Phase 4**: Model schema extensions with pricing adapter
7. **Phase 5**: Git provider abstraction and adapters
8. **Phase 8.1**: Git provider and pricing tests

### Sprint 4: Farm Integration
9. **Phase 6**: Farm/Pod manager updates
10. **Phase 8.2**: Integration tests

### Sprint 5: Polish (Optional)
11. **Phase 7**: Real-time updates (WebSocket or SSE)
12. **Phase 8.3**: Coverage and cleanup

---

## Files to Create

| File | Description |
|------|-------------|
| `src/volundr/adapters/outbound/postgres_stats.py` | Stats repository implementation |
| `src/volundr/adapters/outbound/postgres_tokens.py` | Token tracking implementation |
| `src/volundr/adapters/outbound/pricing.py` | Hardcoded pricing provider |
| `src/volundr/adapters/outbound/github.py` | GitHub provider adapter |
| `src/volundr/adapters/outbound/gitlab.py` | GitLab provider adapter |
| `src/volundr/adapters/outbound/git_factory.py` | Git provider factory |

## Files to Modify

| File | Changes |
|------|---------|
| `src/volundr/domain/models.py` | Add Session fields, Stats, Model, enums |
| `src/volundr/domain/ports.py` | Add StatsRepository, TokenTracker, GitProvider, PricingProvider |
| `src/volundr/domain/services.py` | Update SessionService, add StatsService |
| `src/volundr/adapters/inbound/rest.py` | Update schemas, add stats/usage endpoints |
| `src/volundr/adapters/outbound/postgres.py` | Handle new session fields |
| `src/volundr/adapters/outbound/farm.py` | Return pod_name, pass git info |
| `src/volundr/infrastructure/database.py` | Add new tables and columns |
| `src/volundr/config.py` | Add GitConfig, ModelConfig |
| `src/volundr/main.py` | Wire up new services and adapters |
| `tests/conftest.py` | Update test fixtures |

---

## API Endpoints (Final State)

### Sessions
```
GET    /api/v1/volundr/sessions              - List all sessions
POST   /api/v1/volundr/sessions              - Create session (with repo, branch)
GET    /api/v1/volundr/sessions/{id}         - Get session by ID
PUT    /api/v1/volundr/sessions/{id}         - Update session (name, model, branch)
DELETE /api/v1/volundr/sessions/{id}         - Delete session
POST   /api/v1/volundr/sessions/{id}/start   - Start session pods
POST   /api/v1/volundr/sessions/{id}/stop    - Stop session pods
POST   /api/v1/volundr/sessions/{id}/usage   - Report token usage (from Skuld)
```

### Statistics
```
GET    /api/v1/volundr/stats                 - Get aggregate statistics
```

### Models
```
GET    /api/v1/volundr/models                - List available models (with pricing)
```

### Health
```
GET    /health                               - Health check
```

---

## Session Schema (Final State)

```json
{
  "id": "uuid",
  "name": "string",
  "model": "string",
  "status": "created | starting | running | stopping | stopped | failed",
  "repo": "string",
  "branch": "string",
  "chat_endpoint": "string | null",
  "code_endpoint": "string | null",
  "pod_name": "string | null",
  "error": "string | null",
  "message_count": "integer",
  "tokens_used": "integer",
  "last_active": "ISO 8601 datetime",
  "created_at": "ISO 8601 datetime",
  "updated_at": "ISO 8601 datetime"
}
```

---

## Model Schema (Final State)

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "provider": "cloud | local",
  "tier": "frontier | balanced | execution | reasoning",
  "color": "string",
  "cost_per_million_tokens": "number | null",
  "vram_required": "string | null"
}
```

---

## Stats Schema

```json
{
  "active_sessions": "integer",
  "total_sessions": "integer",
  "tokens_today": "integer",
  "local_tokens": "integer",
  "cloud_tokens": "integer",
  "cost_today": "number (USD)"
}
```

---

*Völundr Implementation Roadmap v2.0 — Hlidskjalf UI Integration*
