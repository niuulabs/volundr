---
hide:
  - navigation
  - toc
---

<div class="volundr-hero" markdown>

# Volundr

<p class="tagline">Self-hosted remote development platform on Kubernetes</p>

<div class="hero-buttons">
  <a href="getting-started/installation/" class="primary">Get started</a>
  <a href="architecture/overview/" class="secondary">Architecture</a>
  <a href="api/openapi/" class="secondary">API reference</a>
</div>

</div>

<div class="screenshot-full" markdown>

![Session dashboard](images/dashboard.png)

</div>

A platform for running managed, isolated AI coding agent sessions on your own Kubernetes cluster. Volundr manages the full lifecycle — spinning up isolated workspaces in Kubernetes pods where developers interact with AI coding agents (like Claude Code) through a browser.

## Features

<div class="feature-grid" markdown>

<div class="feature" markdown>

### :material-kubernetes: Isolated sessions

Create, start, stop, and archive coding sessions with model selection. Each session gets its own Kubernetes pod with a dedicated workspace PVC and storage quotas.

</div>

<div class="feature" markdown>

### :material-source-branch: Git workflows

Branch creation, PR management, CI status checks, and merge confidence scoring across GitHub and GitLab.

</div>

<div class="feature" markdown>

### :material-timeline-text: Chronicles

Session history with timelines, file diffs, and commit summaries. See exactly what changed and when.

</div>

<div class="feature" markdown>

### :material-shield-lock: Secret injection

Mount secrets into sessions via Infisical, OpenBao/Vault, or in-memory backends. Volundr never sees secret values.

</div>

<div class="feature" markdown>

### :material-account-group: Multi-tenancy & auth

Hierarchical tenants with roles and quota enforcement. IDP-agnostic OIDC authentication via Envoy, authorization via Cerbos.

</div>

<div class="feature" markdown>

### :material-puzzle: Integrations & events

Issue trackers (Linear, Jira), MCP servers, SSE streaming, and event pipelines to PostgreSQL, RabbitMQ, and OpenTelemetry.

</div>

</div>

## Components

| Component | Role |
|-----------|------|
| <span class="component-name">Volundr API</span> | FastAPI/Python backend — session CRUD, workspace provisioning, git integration, secret management, multi-tenant access control |
| <span class="component-name">Skuld</span> | WebSocket broker — connects the browser UI to AI coding agents running inside session pods |
| <span class="component-name">Web UI</span> | React web UI — session management, chronicles, diffs, terminal access, and admin |

## Tech stack

FastAPI · asyncpg (raw SQL, no ORM) · React/Vite/CSS Modules · Kubernetes/Helm · OIDC/Cerbos · OpenTelemetry

## See it in action

<div class="screenshot-showcase" markdown>

<div class="showcase-item" markdown>

### Sign in

Volundr uses standard OIDC for authentication and is fully IDP-agnostic — connect Keycloak, Entra ID, Okta, or any compliant provider. Users sign in through your existing identity infrastructure with no vendor lock-in.

![Login](images/login.png)

</div>

<div class="showcase-item" markdown>

### Launch a session

The launch wizard walks you through session creation in two steps: pick a workspace template, then configure resources, credentials, and integrations. Templates are fully customisable, letting teams standardise their environments while keeping things flexible.

![Launch wizard](images/launch-wizard.png)

</div>

<div class="showcase-item" markdown>

### Chat with the agent

The session dashboard is where you interact with your AI coding agent. Chat back and forth, watch work happen in real time, and switch between tabs for the terminal, code, diffs, and logs — all from the browser.

![Session chat](images/dashboard.png)

</div>

<div class="showcase-item" markdown>

### Review changes

The built-in diff viewer gives you a clear view of every file the agent has touched. Review changes inline before committing, catch issues early, and keep full control over what lands in your codebase.

![Session diffs](images/session-diffs.png)

</div>

<div class="showcase-item" markdown>

### Browse the timeline

Chronicles capture the full history of a session — every commit, file change, and agent action laid out on a timeline. Scroll back to see exactly what happened and when, making it easy to audit work or pick up where you left off.

![Chronicle timeline](images/chronicle-timeline.png)

</div>

<div class="showcase-item" markdown>

### Full workspace access

Each session provides a complete workspace with an integrated terminal and a full VS Code instance running remotely inside the Kubernetes pod. Edit code, install extensions, debug, and run commands — all from the browser, just like you would locally.

![Session workspace](images/session-workspace.png)

</div>

</div>

## Quick links

- [Quick start](getting-started/quick-start.md) — get running in 5 minutes
- [Installation guide](installation/overview.md) — deployment options and setup
- [User guide](user-guide/sessions.md) — sessions, templates, chronicles, CLI
- [Configuration](configuration/overview.md) — adapters, identity, secrets, storage
- [API reference](api/openapi.md) — interactive OpenAPI documentation
- [Contributing](contributing/development.md) — development workflow
