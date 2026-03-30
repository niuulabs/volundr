# Troubleshooting

Common issues when running Volundr locally and how to fix them.

---

## `claude` binary not found

**Symptom**: Session starts but the AI agent fails to respond, or logs show `claude: command not found`.

**Cause**: The `claude` CLI is not installed or not on your `PATH`.

**Fix**:

```bash
# Check if claude is installed
which claude

# If not found, install it (see https://docs.anthropic.com/en/docs/claude-code)
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

If `claude` is installed but in a non-standard location, make sure it's on your `PATH`:

```bash
export PATH="$PATH:/path/to/claude/directory"
```

---

## API key invalid or missing

**Symptom**: Sessions fail to start, logs show authentication errors or `401 Unauthorized` from the Anthropic API.

**Cause**: The Anthropic API key is missing, expired, or incorrect.

**Fix**:

```bash
# Re-run init to update the key
volundr init

# Or edit the config directly
volundr config set anthropic.api_key sk-ant-your-new-key
```

Verify your key works:

```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: sk-ant-your-key" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
```

---

## Port already in use

**Symptom**: `volundr up` fails with `address already in use` or `EADDRINUSE` on port 8080 or 5432.

**Cause**: Another process is using the port Volundr needs.

**Fix**:

```bash
# Find what's using port 8080
lsof -i :8080

# Or on Linux
ss -tlnp | grep 8080
```

Then either stop the conflicting process or configure Volundr to use a different port. If port 5432 is in use, you likely have another PostgreSQL instance running:

```bash
# Check for existing PostgreSQL
lsof -i :5432

# Stop a Homebrew PostgreSQL (macOS)
brew services stop postgresql

# Stop a system PostgreSQL (Linux)
sudo systemctl stop postgresql
```

---

## Session stuck in PROVISIONING

**Symptom**: A session stays in `PROVISIONING` state and never transitions to `RUNNING`.

**Cause**: The workspace setup is taking too long or failed silently. Common reasons:

- Git clone is slow or failing (see below)
- Setup scripts in the template are failing
- Insufficient disk space

**Fix**:

```bash
# Check session status for error details
volundr sessions list --json | jq '.[] | select(.state == "PROVISIONING")'

# Check the Volundr API server logs (visible in the terminal where you ran `volundr up`)
```

If the session is permanently stuck, delete it and create a new one:

```bash
volundr sessions delete <session-id>
```

If this happens repeatedly, check disk space:

```bash
df -h
```

---

## Git clone fails

**Symptom**: Session creation fails with git-related errors.

### Authentication errors

**Cause**: GitHub token is missing, expired, or lacks the `repo` scope.

**Fix**:

```bash
# Test your token
curl -s -H "Authorization: token ghp_your-token" https://api.github.com/user | jq .login

# If it fails, create a new token at https://github.com/settings/tokens
# Ensure it has the `repo` scope

# Update the token
volundr init
```

### Network errors

**Cause**: DNS resolution failure, proxy issues, or firewall blocking GitHub.

**Fix**:

```bash
# Test connectivity to GitHub
curl -s https://api.github.com/zen

# If behind a corporate proxy, set the proxy environment variables
export HTTP_PROXY=http://proxy:8080
export HTTPS_PROXY=http://proxy:8080
```

### Repository not found

**Cause**: The repo URL is wrong, or your token doesn't have access to the org.

**Fix**:

- Double-check the repository URL (use `org/repo` format, not the full HTTPS URL)
- Verify your token has access: `curl -s -H "Authorization: token ghp_..." https://api.github.com/repos/org/repo | jq .full_name`
- Make sure the org is listed in your Volundr config (`volundr init` asks for orgs)

---

## `volundr up` fails immediately

**Symptom**: `volundr up` exits right after starting.

**Cause**: Usually a configuration issue.

**Fix**:

1. Check that `volundr init` was run first:
    ```bash
    ls ~/.volundr/config.yaml
    ```

2. Try running with debug logging:
    ```bash
    VOLUNDR_TUI_DEBUG=1 volundr up
    ```

3. Check if the embedded PostgreSQL data directory is corrupted:
    ```bash
    # Remove the embedded database and reinitialize
    rm -rf ~/.volundr/data/pg
    volundr init
    ```

---

## Web UI not loading

**Symptom**: `volundr up` succeeds but `http://localhost:8080` shows a blank page or connection refused.

**Fix**:

1. Verify services are running:
    ```bash
    volundr status
    ```

2. Check that the proxy service is running and bound to port 8080.

3. Try accessing the API directly:
    ```bash
    curl http://localhost:8080/health
    ```
    Expected: `{"status": "healthy"}`

4. If the health check works but the page is blank, try a hard refresh (`Ctrl+Shift+R`) or clear your browser cache.

---

## Getting help

If none of these solutions work:

1. Check the [GitHub Issues](https://github.com/niuulabs/volundr/issues) for similar problems.
2. Open a new issue with:
    - Your OS and architecture (`uname -a`)
    - Volundr version (`volundr version`)
    - The full error output
    - Your runtime mode (`local`, `docker`, or `k3s`)
