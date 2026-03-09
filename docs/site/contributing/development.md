# Development

## Setup

```bash
git clone https://github.com/niuulabs/volundr.git
cd volundr
uv sync --all-extras --dev

# Web UI
cd web && npm install
```

## Project structure

```
volundr/
├── src/volundr/        # Python backend
│   ├── domain/         # Models, ports, services
│   ├── adapters/       # Inbound (REST) and outbound (infra)
│   ├── infrastructure/ # Database setup
│   ├── skuld/          # WebSocket broker
│   └── config.py       # Settings
├── web/                # React frontend
├── tests/              # Backend tests
├── charts/             # Helm charts
│   ├── volundr/        # API server chart
│   └── skuld/          # Broker chart
├── migrations/         # SQL migrations
└── docs/               # Documentation site
```

## Running locally

```bash
# Start PostgreSQL
docker run -d --name volundr-pg \
  -e POSTGRES_USER=volundr -e POSTGRES_PASSWORD=volundr -e POSTGRES_DB=volundr \
  -p 5432:5432 postgres:16

# Start the API
uv run uvicorn volundr.main:app --reload --port 8080

# Start the UI (separate terminal)
cd web && npm run dev
```

## Entry points

| Command | Description |
|---------|-------------|
| `uv run volundr` | API server (production) |
| `uv run skuld` | Skuld broker |
| `uv run uvicorn volundr.main:app --reload` | API with auto-reload |

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sessions): add archive-stopped bulk operation
fix(chronicles): prevent duplicate timeline events
docs: update API reference
test(tracker): add Jira adapter unit tests
```

See [Code Style](code-style.md) for formatting and architecture rules.
