# Hexagonal Design

All infrastructure is abstracted behind port interfaces. Business logic (domain services) never imports adapters directly.

## Directory structure

```
src/volundr/
├── domain/
│   ├── models.py          # Domain models (Session, Chronicle, Tenant, etc.)
│   ├── ports.py           # Port interfaces (abstract base classes)
│   └── services/          # Business logic
│       ├── session.py
│       ├── chronicle.py
│       ├── git_workflow.py
│       ├── credential.py
│       ├── tenant.py
│       ├── tracker.py
│       ├── event_ingestion.py
│       ├── profile.py
│       ├── template.py
│       ├── preset.py
│       ├── prompt.py
│       └── ...
├── adapters/
│   ├── inbound/           # REST endpoints (FastAPI routers)
│   │   ├── rest.py        # Sessions, chronicles, models, stats
│   │   ├── rest_git.py    # Git workflows
│   │   ├── rest_profiles.py
│   │   ├── rest_presets.py
│   │   ├── rest_prompts.py
│   │   ├── rest_tenants.py
│   │   ├── rest_credentials.py
│   │   ├── rest_secrets.py
│   │   ├── rest_events.py
│   │   ├── rest_tracker.py
│   │   ├── rest_integrations.py
│   │   └── auth.py        # Auth middleware
│   └── outbound/          # Infrastructure adapters
│       ├── postgres*.py   # PostgreSQL repositories
│       ├── pod_manager.py # Pod orchestration
│       ├── github.py      # GitHub API
│       ├── gitlab.py      # GitLab API
│       ├── identity.py    # OIDC identity
│       ├── cerbos.py      # Cerbos authorization
│       ├── linear.py      # Linear issue tracker
│       ├── jira.py        # Jira issue tracker
│       └── ...
├── infrastructure/
│   └── database.py        # Connection pool management
├── skuld/                 # WebSocket broker (separate process)
├── config.py              # Pydantic settings
└── main.py                # Composition root
```

## Layer rules

| Layer | Can import from | Cannot import from |
|-------|----------------|-------------------|
| Domain services | `domain.ports`, `domain.models` | `adapters`, `infrastructure` |
| Adapters | `domain.ports`, `domain.models` | Other adapters |
| `main.py` | Everything | — |

## Ports

Ports are abstract base classes in `domain/ports.py`. Each defines the contract that adapters must implement:

| Port | Purpose |
|------|---------|
| `SessionRepository` | Session persistence (CRUD) |
| `ChronicleRepository` | Chronicle persistence |
| `TimelineRepository` | Timeline event persistence |
| `PodManager` | Start/stop session pods |
| `StatsRepository` | Aggregate statistics |
| `TokenTracker` | Token usage recording |
| `PricingProvider` | Model pricing data |
| `GitProvider` | Git repository operations |
| `GitWorkflowProvider` | PR/branch/CI operations |
| `EventBroadcaster` | SSE event publishing |
| `EventSink` | Event pipeline sinks |
| `SessionEventRepository` | Event query (read side) |
| `ProfileProvider` | Config-driven profiles |
| `TemplateProvider` | Config-driven templates |
| `PresetRepository` | Preset persistence |
| `SavedPromptRepository` | Prompt persistence |
| `MCPServerProvider` | MCP server configs |
| `SecretManager` | K8s secret management |
| `IdentityPort` | JWT validation, user provisioning |
| `AuthorizationPort` | Policy decisions |
| `CredentialStorePort` | Credential storage |
| `SecretInjectionPort` | CSI secret mounting |
| `StoragePort` | PVC management |
| `GatewayPort` | Gateway API routing |
| `IssueTrackerProvider` | External issue trackers |
| `IntegrationRepository` | Integration connections |
| `TenantRepository` | Tenant hierarchy |
| `UserRepository` | User persistence |
| `WorkspaceRepository` | Workspace persistence |
| `SessionContributor` | Session spec contributors |

## Dynamic adapter pattern

New adapters use dynamic import. Config specifies a fully-qualified class path — remaining keys are passed as kwargs:

```yaml
credential_store:
  adapter: "volundr.adapters.outbound.vault_credential_store.VaultCredentialStore"
  kwargs:
    url: "http://vault:8200"
    auth_method: "kubernetes"
```

The composition root (`main.py`) imports the class and instantiates it:

```python
cls = _import_class(config.adapter)
instance = cls(**config.kwargs)
```

Adding a new adapter = write the class + update YAML. No code changes in the container.
