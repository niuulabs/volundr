# CLI Reference

The Volundr CLI operates in two modes: local (run everything on your machine) and remote (connect to a Volundr server). Run it without arguments to launch the interactive TUI.

## Local mode

Run the full Volundr stack locally for development or single-user use.

### `volundr init`

Interactive setup wizard. Walks you through:

- Runtime selection (local, docker, k3s)
- Anthropic API key
- Database mode (embedded PostgreSQL or external PostgreSQL)
- GitHub/GitLab configuration

Creates `~/.volundr/config.yaml` and stores credentials encrypted.

### `volundr up`

Start all services — PostgreSQL (if embedded), API server, and reverse proxy. Blocks until you hit Ctrl+C.

| Flag | Description |
|------|-------------|
| `--runtime <runtime>` | Override the configured runtime |
| `--no-web` | Disable the embedded web UI |

### `volundr down`

Stop all services gracefully.

### `volundr status`

Print a status table showing each service's state:

```
SERVICE      STATE    PID    PORT   ERROR
postgresql   running  1234   5432
api-server   running  1235   8080
proxy        running  1236   8443
```

## Remote mode

Connect to a Volundr server running on Kubernetes.

### Authentication

#### `volundr login`

Authenticate via OIDC. Opens your browser for the authorization code flow.

| Flag | Description |
|------|-------------|
| `--issuer <url>` | OIDC issuer URL |
| `--client-id <id>` | OIDC client ID |
| `--device` | Use device code flow (for headless environments) |
| `--force` | Force re-authentication even if tokens are valid |
| `--context <name>` | Login to a specific context |

#### `volundr logout`

Clear stored tokens for the current context.

#### `volundr whoami`

Show current user info: name, email, issuer, and token expiry.

### Sessions

Alias: `volundr s` is shorthand for `volundr sessions`.

#### `volundr sessions list`

List all your sessions.

#### `volundr sessions create`

Create a new session.

| Flag | Description |
|------|-------------|
| `-n, --name <name>` | Session name |
| `-r, --repo <repo>` | Repository URL |
| `-m, --model <model>` | AI model to use |
| `-b, --branch <branch>` | Git branch |

#### `volundr sessions start <id>`

Start a stopped session.

#### `volundr sessions stop <id>`

Stop a running session.

#### `volundr sessions delete <id>`

Delete a session permanently.

### Contexts

Contexts let you manage connections to multiple Volundr servers.

#### `volundr context add <key> --server <url>`

Add a server context.

| Flag | Description |
|------|-------------|
| `--name <name>` | Display name |
| `--issuer <url>` | OIDC issuer URL |
| `--client-id <id>` | OIDC client ID |

#### `volundr context list`

List all configured contexts.

#### `volundr context remove <key>`

Remove a context.

#### `volundr context rename <old> <new>`

Rename a context.

### Config

#### `volundr config get <key>`

Get a config value.

#### `volundr config set <key> <value>`

Set a config value.

### `volundr version`

Print version information.

## Interactive TUI

Run `volundr` with no arguments (or `volundr tui`) to launch the full-screen terminal UI. Navigate between pages with keyboard shortcuts:

| Page | Shortcut | Description |
|------|----------|-------------|
| Sessions | Alt+1 | Session list with status filters |
| Chat | Alt+2 | Conversation with the AI agent |
| Terminal | Alt+3 | PTY terminal with tmux-style tabs |
| Diffs | Alt+4 | File changes and unified diffs |
| Chronicles | Alt+5 | Timeline with token burn graph |
| Settings | Alt+6 | Connection, credentials, integrations, appearance |
| Admin | Alt+7 | Users, tenants, stats (admin only) |

## Global flags

These flags work with any command:

| Flag | Description |
|------|-------------|
| `--home <path>` | Override config directory |
| `--server <url>` | Override server URL |
| `--token <token>` | Use a specific auth token |
| `--config <path>` | Use a specific config file |
| `--context <name>` | Use a specific context |
| `--json` | Output as JSON for scripting |

## Config files

| Mode | Path | Contents |
|------|------|----------|
| Local | `~/.volundr/config.yaml` | Runtime settings, database config, API keys |
| Remote | `~/.config/volundr/config.yaml` | Server contexts, auth tokens |

## Environment variables

| Variable | Description |
|----------|-------------|
| `VOLUNDR_HOME` | Override the config directory path |
| `VOLUNDR_TUI_DEBUG=1` | Enable debug logging for the TUI |

## JSON output

All commands support the `--json` flag. Use it for scripting and automation:

```bash
volundr sessions list --json | jq '.[].name'
```
