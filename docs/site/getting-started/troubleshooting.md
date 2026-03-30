# Troubleshooting

Common issues when running Volundr locally and how to fix them.

---

## `niuu: command not found`

The `niuu` binary is not in your PATH.

**Fix:**

```bash
# Check if the binary exists
ls -la /usr/local/bin/niuu

# If not, re-download and install it
curl -fsSL https://github.com/niuulabs/volundr/releases/latest/download/niuu-darwin-arm64 -o niuu
chmod +x niuu
sudo mv niuu /usr/local/bin/
```

Make sure `/usr/local/bin` is in your PATH:

```bash
echo $PATH | tr ':' '\n' | grep /usr/local/bin
```

If not, add it to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export PATH="/usr/local/bin:$PATH"
```

---

## `claude` binary not found

Volundr sessions use the `claude` CLI as the AI agent. If it's not installed, sessions will fail to start.

**Fix:**

Install the Claude CLI:

```bash
# macOS
brew install claude

# Or download directly from https://claude.ai/download
```

Verify it's available:

```bash
claude --version
```

---

## Anthropic API key invalid or missing

**Symptoms:**

- Sessions fail during PROVISIONING
- Error: `authentication_error` or `invalid_api_key`

**Fix:**

1. Check your key is set:

    ```bash
    niuu config get anthropic.api_key
    ```

2. If missing or wrong, re-run the init wizard:

    ```bash
    niuu volundr init
    ```

3. Or set it directly:

    ```bash
    niuu config set anthropic.api_key sk-ant-api03-xxxx...
    ```

Make sure your key starts with `sk-ant-` and has not expired.

---

## Port already in use

**Symptoms:**

- `niuu volundr up` fails with "address already in use"
- Error on port 5432 (PostgreSQL) or 8080 (API server)

**Fix:**

Find what's using the port:

```bash
# macOS
lsof -i :8080

# Linux
ss -tlnp | grep 8080
```

Either stop the conflicting process, or use a different port:

```bash
# For the API server
HOST=127.0.0.1 PORT=9000 niuu volundr up
```

If port 5432 is in use, you likely have another PostgreSQL instance running. Either stop it or switch to external database mode:

```bash
niuu volundr init  # Select "external" database mode and point to your existing PostgreSQL
```

---

## Session stuck in PROVISIONING

**Symptoms:**

- Session status shows `PROVISIONING` for more than 60 seconds
- No error message visible

**Fix:**

1. Check service status:

    ```bash
    niuu volundr status
    ```

    All services should show `running`. If any show errors, restart:

    ```bash
    niuu volundr down
    niuu volundr up
    ```

2. Check the API server logs for errors. Look for messages about failed health checks or database connectivity.

3. If using embedded PostgreSQL, make sure the database started successfully (check for port 5432 in the status output).

4. Try stopping and re-creating the session.

---

## Git clone fails

**Symptoms:**

- Session fails during PROVISIONING with a git error
- Error mentions authentication, permissions, or network issues

### Authentication errors

Make sure your GitHub token has the correct scopes:

- `repo` — full control of private repositories
- `read:org` — if you're accessing organization repos

Re-configure the token:

```bash
niuu volundr init  # Re-enter your GitHub token when prompted
```

### Network errors

If you're behind a corporate proxy:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080
niuu volundr up
```

### Repository not found

- Verify the repo URL is correct (e.g. `my-org/my-repo`, not the full HTTPS URL)
- Verify your token has access to the repository
- For GitHub Enterprise, make sure the API URL is set correctly in your configuration

---

## Database connection errors

**Symptoms:**

- API server fails to start
- Error: `connection refused` on port 5432

**Fix:**

If using embedded mode, the embedded PostgreSQL may have failed to start:

```bash
# Check if PostgreSQL is running
niuu volundr status

# Try restarting
niuu volundr down
niuu volundr up
```

If using external mode, verify your database configuration:

```bash
# Test the connection
psql -h localhost -U volundr -d volundr
```

---

## Web UI shows blank page or connection error

**Symptoms:**

- Browser shows "connection refused" or blank page at `http://localhost:8080`

**Fix:**

1. Verify Volundr is running:

    ```bash
    niuu volundr status
    ```

2. Check the health endpoint:

    ```bash
    curl http://localhost:8080/health
    ```

    Expected: `{"status": "healthy"}`

3. If the health check fails, check that the API server started on the expected port. Look at the terminal where you ran `niuu volundr up` for error messages.

4. Try a hard refresh in your browser (Cmd+Shift+R / Ctrl+Shift+R).

---

## Getting more help

If your issue isn't listed here:

1. Check the [API server logs](running.md) for detailed error messages
2. Run with debug logging:

    ```bash
    VOLUNDR_LOG_LEVEL=debug niuu volundr up
    ```

3. File an issue at [github.com/niuulabs/volundr/issues](https://github.com/niuulabs/volundr/issues)
