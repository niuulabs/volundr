# Credentials & Secrets

Two separate systems. Don't confuse them.

## Credentials

Credentials are API keys, tokens, and SSH keys that **you** manage. You create them, Volundr stores them encrypted in a pluggable credential store (Vault, Infisical, or in-memory for dev).

Credential types:

- **API keys** — for external services (Linear, Jira, etc.)
- **OAuth tokens** — for source control providers
- **SSH keys** — for git access over SSH

Each credential has a name, type, and encrypted data.

### Using credentials in a session

1. Go to **Settings > Credentials** in the web UI and store your credential.
2. When launching a session, select which credentials to inject.
3. The `SecretInjectionContributor` mounts them into the pod as environment variables or files.

You can also manage credentials via the API or CLI.

## Secrets

Secrets use CSI-based injection for infrastructure-level secrets. Volundr never sees the secret values. It generates pod spec additions that tell the CSI driver (Infisical or OpenBao/Vault) what to mount and where.

### The key difference

**Credentials** — user-managed. You create them, Volundr stores them encrypted, and injects them into pods on your behalf.

**Secrets** — infrastructure-managed. The CSI driver fetches them directly from the vault at pod startup. Volundr only knows the path — it never handles the actual secret value.

Use credentials for things you control (your API keys, your tokens). Use secrets for things your platform team controls (database passwords, TLS certs, shared service accounts).
