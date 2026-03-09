# Installation

## Prerequisites

- Python 3.11+ (3.12 recommended)
- PostgreSQL 12+
- Node.js 22+ (for the web UI)
- Kubernetes 1.24+ and Helm 3.8+ (for deployment)

## Backend

Volundr uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
# Clone the repository
git clone https://github.com/niuulabs/volundr.git
cd volundr

# Install core dependencies
uv sync --dev

# Or install with all optional extras
uv sync --all-extras --dev
```

### Optional extras

Install only the extras you need:

```bash
uv sync --extra rabbitmq   # RabbitMQ event sink (aio-pika)
uv sync --extra litellm    # LiteLLM model routing
uv sync --extra k8s        # Kubernetes client (kubernetes-asyncio)
uv sync --extra otel       # OpenTelemetry export (traces + metrics)
```

## Web UI

```bash
cd web
npm install
```

## Database

Volundr needs a PostgreSQL database. Tables are auto-created on startup for development.

```bash
# Create the database
createdb volundr

# Or via Docker
docker run -d --name volundr-pg \
  -e POSTGRES_USER=volundr \
  -e POSTGRES_PASSWORD=volundr \
  -e POSTGRES_DB=volundr \
  -p 5432:5432 \
  postgres:16
```

## Configuration

Copy the example config and edit it:

```bash
cp config.yaml.example config.yaml
```

See [Configuration](configuration.md) for the full reference.
