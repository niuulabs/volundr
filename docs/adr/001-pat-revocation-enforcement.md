# ADR-001: PAT Revocation Enforcement

## Status

Accepted

## Context

PATs are long-lived JWTs (default 365 days) signed with HS256 and validated
statelessly by Envoy. When a user revokes a PAT, the token hash is deleted
from Postgres, but Envoy continues accepting the JWT until it expires.
A compromised token cannot be immediately invalidated.

### Constraints

- **No Redis** — architecture rules prohibit external state stores.
- **Envoy validates statelessly** — we cannot change Envoy's JWT filter to
  call out to a revocation service without adding ext_authz infrastructure.
- **Two services** — both Tyr and Volundr must enforce revocation.
- **Shared code** — PAT infrastructure lives in `src/niuu/`.

## Decision

We implement an **application-layer revocation check** using an in-memory
TTL cache in each service process.

### How it works

1. **FastAPI middleware** (`PATRevocationMiddleware`) intercepts every
   request with `Authorization: Bearer <token>`.
2. The middleware delegates to `PATValidator.is_valid(raw_token)`.
3. `PATValidator`:
   - Decodes the JWT (without signature verification — Envoy handles that).
   - If `type` != `"pat"`, passes through (not a PAT).
   - SHA-256-hashes the raw JWT.
   - Checks an in-memory cache keyed by hash.
   - On cache miss, queries `PATRepository.exists_by_hash(hash)`.
   - Caches the result with a configurable TTL (default 5 minutes for
     valid tokens, 60 seconds for revoked tokens).
4. If the token is revoked (hash not found in DB), the middleware returns
   `401 Token has been revoked`.

### Revocation window

- **Maximum delay**: the cache TTL (default 5 minutes).
- **Typical delay**: under 60 seconds for tokens that were recently checked
  (the 60-second negative cache ensures quick re-check).
- **Immediate**: if the token has never been cached in this process.

### Performance

- **Hot path** (non-revoked token, cached): one in-memory dict lookup — no DB.
- **Cold path** (first use or cache expired): one `SELECT 1 ... WHERE token_hash = $1`
  query — indexed, sub-millisecond.
- **Memory**: one dict entry per active token per process. At 1000 concurrent
  PATs this is negligible.

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Short-lived JWTs + refresh | Standard OIDC pattern | Requires refresh flow, breaks autonomous dispatch UX |
| Envoy ext_authz | Centralized enforcement | New infrastructure, added latency on every request |
| Redis blocklist | Shared across processes | Violates "no Redis" architecture rule |
| **In-memory cache (chosen)** | Zero new infrastructure, bounded window | Per-process cache, not instant |

## Consequences

- Revoking a PAT makes it unusable within ≤5 minutes (configurable).
- Each Tyr/Volundr process maintains its own cache — in a multi-worker
  deployment, different workers may enforce revocation at slightly different
  times within the window.
- The `exists_by_hash` query is lightweight and indexed.
- Non-PAT tokens (OIDC JWTs) are unaffected — the middleware passes them through.
