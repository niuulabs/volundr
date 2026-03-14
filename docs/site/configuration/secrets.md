# Secret Management

Two separate systems for different purposes.

## Credential Store (CredentialStorePort)

User-managed secrets like API keys and tokens. Users store and retrieve their own credentials through the Volundr UI or API.

| Adapter | Description |
|---------|-------------|
| `MemoryCredentialStore` | Development — in-memory, lost on restart |
| `VaultCredentialStore` | OpenBao/Vault KV v2 |
| `InfisicalCredentialStore` | Infisical secret manager |

### Vault

```yaml
credentialStore:
  adapter: "volundr.adapters.outbound.vault_credential_store.VaultCredentialStore"
  kwargs:
    url: "http://vault:8200"
    auth_method: "kubernetes"
    mount_path: "secret"
```

### Infisical

```yaml
credentialStore:
  adapter: "volundr.adapters.outbound.infisical_credential_store.InfisicalCredentialStore"
  kwargs:
    site_url: "https://app.infisical.com"
    client_id: "..."
    client_secret: "..."
    project_id: "..."
```

## Secret Injection (SecretInjectionPort)

Infrastructure secrets mounted into session pods via CSI drivers. Volundr never sees secret values. It generates pod spec additions that tell the CSI driver what to mount. The CSI driver fetches secrets directly from the vault.

| Adapter | Description |
|---------|-------------|
| `InMemorySecretInjectionAdapter` | Development — no-op |
| `InfisicalCSISecretInjectionAdapter` | Infisical Secrets Operator + CSI driver |
| `OpenBaoCSISecretInjectionAdapter` | OpenBao/Vault CSI driver |

### Infisical CSI

```yaml
secretInjection:
  adapter: "volundr.adapters.outbound.infisical_secret_injection.InfisicalCSISecretInjectionAdapter"
  kwargs:
    infisical_url: "https://infisical.example.com"
    client_id: "..."
    client_secret: "..."
    namespace: "volundr-sessions"
```

### OpenBao CSI

```yaml
secretInjection:
  adapter: "volundr.adapters.outbound.openbao_secret_injection.OpenBaoCSISecretInjectionAdapter"
  kwargs:
    vault_url: "http://openbao:8200"
    namespace: "volundr-sessions"
```

## Secret Repository (SecretRepository)

Used internally for OpenBao/Vault operations. Not directly configurable as an adapter — it is wired by the application when Vault-based credential store is active.

Responsibilities:

- Store credentials at vault paths
- Provision per-user policies and Kubernetes auth roles
- Create ephemeral session secrets
- Clean up on user deprovisioning
