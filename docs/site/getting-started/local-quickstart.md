# Local Quickstart

Go from zero to a working AI coding session on your machine. No Kubernetes required.

---

## Prerequisites

| Requirement | Why |
|------------|-----|
| macOS or Linux | The CLI runs on both platforms (Intel and ARM) |
| An Anthropic API key | Powers the AI coding agent ([get one here](https://console.anthropic.com/)) |
| A GitHub personal access token | For cloning private repos ([create one here](https://github.com/settings/tokens)) |
| `claude` CLI (optional) | Required if you want Claude Code as your session agent |

---

## Step 1: Download the CLI

```bash
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH="amd64"; [ "$ARCH" = "aarch64" ] && ARCH="arm64"
curl -fsSL "https://github.com/niuulabs/volundr/releases/latest/download/volundr-${OS}-${ARCH}" -o volundr
chmod +x volundr
sudo mv volundr /usr/local/bin/
```

Verify it works:

```bash
volundr version
```

Expected output:

```
volundr version 0.x.x (commit abc1234)
```

---

## Step 2: Initialize

```bash
volundr init
```

The interactive wizard walks you through setup. Here are the prompts and recommended answers for local development:

```
? Select runtime: local
? Anthropic API key: sk-ant-xxxxxxxxxxxx
? Database mode: embedded
? GitHub personal access token: ghp_xxxxxxxxxxxx
? GitHub organizations (comma-separated): your-org
? GitHub API URL: https://api.github.com
```

| Prompt | What to enter |
|--------|---------------|
| **Runtime** | `local` — runs everything as local processes, no containers needed |
| **Anthropic API key** | Your `sk-ant-...` key from the Anthropic console |
| **Database mode** | `embedded` — bundles PostgreSQL so you don't need to install it |
| **GitHub token** | A personal access token with `repo` scope |
| **GitHub orgs** | Comma-separated list of orgs whose repos you want to access |
| **GitHub API URL** | `https://api.github.com` (change only for GitHub Enterprise) |

This creates `~/.volundr/config.yaml` and stores your credentials encrypted.

---

## Step 3: Start Volundr

```bash
volundr up
```

Volundr starts three services:

```
SERVICE      STATE    PID    PORT
postgresql   running  1234   5432
api-server   running  1235   8080
proxy        running  1236   8443
```

Wait until all services show `running`. The web UI is available at [http://localhost:8080](http://localhost:8080).

!!! note
    The web UI is embedded in the proxy server. If port 8080 is already in use, see [Troubleshooting](troubleshooting.md#port-already-in-use).

---

## Step 4: Create your first session

### Option A: Web UI

1. Open [http://localhost:8080](http://localhost:8080) in your browser.
2. Click **New Session**.
3. Pick a template or use the default.
4. Fill in:
    - **Name**: `my-first-session`
    - **Repository URL**: `your-org/your-repo`
    - **Branch**: `main` (or any branch)
5. Click **Launch**.

### Option B: CLI

```bash
volundr sessions create \
  --name my-first-session \
  --repo your-org/your-repo \
  --model claude-sonnet-4
```

Then start it:

```bash
volundr sessions start <session-id>
```

---

## Step 5: Watch it start

The session transitions through these states:

```
CREATED → STARTING → PROVISIONING → RUNNING
```

This takes 10–30 seconds depending on repo size.

---

## Step 6: Start coding

Once the session is `RUNNING`:

- **Web UI**: The **Chat** tab opens. Type a message to start working with the AI agent.
- **CLI TUI**: Run `volundr` (no arguments) to launch the terminal UI. Use `Alt+2` for the chat view.

The session gives you:

| Feature | Description |
|---------|-------------|
| **Chat** | Conversation with the AI coding agent |
| **Terminal** | Full shell access to the workspace |
| **Code** | VS Code editor (Code Server) |
| **Diffs** | See what the agent changed |
| **Chronicles** | Session history and summaries |

---

## Step 7: Stop the session

When you're done:

- **Web UI**: Click **Stop**.
- **CLI**: `volundr sessions stop <session-id>`

A chronicle is automatically created — a summary of what happened, the changes made, and the conversation history.

To shut down all Volundr services:

```bash
volundr down
```

---

## Local mode vs K8s modes

| Feature | Local (`local`) | Docker (`docker`) | K3s (`k3s`) | Production K8s |
|---------|:-:|:-:|:-:|:-:|
| No dependencies needed | Yes | Docker required | k3s required | Full cluster |
| Embedded PostgreSQL | Yes | Yes | Helm chart | External |
| Multiple concurrent sessions | Limited | Yes | Yes | Yes |
| Resource isolation | No | Container-level | Pod-level | Pod-level |
| Persistent volumes | Local filesystem | Docker volumes | PVCs | PVCs |
| Gateway/routing | Reverse proxy | Reverse proxy | Ingress | Ingress + Gateway API |
| Auth (OIDC) | Disabled (AllowAll) | Disabled | Optional | Required |
| Best for | Trying it out, solo dev | Local dev with isolation | Full-stack local testing | Teams, production |

---

## Next steps

- [Troubleshooting](troubleshooting.md) — common errors and how to fix them
- [Configuration](configuration.md) — customize models, integrations, and adapters
- [CLI Reference](../user-guide/cli.md) — full command reference
