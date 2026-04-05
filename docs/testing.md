# Testing Guide

This document covers how to run the unit, integration, and end-to-end (E2E)
test suites locally and in CI.

## Prerequisites

### Unit tests

No external services required — just install Python dependencies:

```bash
uv sync
```

### Integration tests

Integration tests hit a **real PostgreSQL database**. You need:

1. **PostgreSQL running locally** (default port 5432).
2. **A test database and user** created ahead of time:

```sql
CREATE USER volundr_test WITH PASSWORD 'volundr_test';
CREATE DATABASE volundr_test OWNER volundr_test;
```

### E2E tests (Playwright)

1. **Backend running** — the API server must be reachable.
2. **Frontend dev server** — Playwright's config auto-starts `npm run dev` if
   nothing is already listening on `http://localhost:5174`.
3. **Playwright browsers installed**:

```bash
cd web
npx playwright install --with-deps chromium
```

## Environment variables

The integration test fixtures read these variables (all have sensible defaults):

| Variable | Default | Description |
|---|---|---|
| `TEST_DATABASE_HOST` | `localhost` | PostgreSQL host |
| `TEST_DATABASE_PORT` | `5432` | PostgreSQL port |
| `TEST_DATABASE_USER` | `volundr_test` | Database user |
| `TEST_DATABASE_PASSWORD` | `volundr_test` | Database password |
| `TEST_DATABASE_NAME` | `volundr_test` | Database name |

Override them when your local setup differs:

```bash
TEST_DATABASE_PORT=5433 make test-integration
```

## Running each test suite

### Unit tests

```bash
make test
# or directly:
uv run pytest tests/ -v --tb=short
```

### Integration tests

```bash
# All integration tests (Volundr + Tyr)
make test-integration

# Volundr integration tests only
make test-integration-volundr

# Tyr integration tests only
make test-integration-tyr
```

All integration test targets pass `-m integration` to pytest, which selects
tests marked with `@pytest.mark.integration`.

### E2E tests (Playwright)

```bash
# Headless (CI-friendly)
make test-e2e

# Interactive Playwright UI (great for debugging)
make test-e2e-ui
```

### Everything at once

```bash
make test-all
```

This runs `make test`, `make test-integration`, and `make test-e2e`
sequentially.

## How transaction rollback isolation works

Integration tests use a **per-test transactional wrapper** to guarantee zero
data leakage between tests:

1. A **session-scoped** `db_pool` fixture creates a real `asyncpg` pool and
   applies all migrations once per session.
2. A **function-scoped** `txn_pool` fixture acquires a connection from the
   pool, starts a transaction (`BEGIN`), and wraps it in a `TransactionalPool`.
3. The `TransactionalPool` is a drop-in replacement for `asyncpg.Pool` — its
   `acquire()` method returns the same underlying connection so every
   repository operation in the test shares one transaction.
4. After the test completes, the fixture issues `ROLLBACK`, undoing all writes.

This means tests can insert, update, and delete rows freely without affecting
other tests or requiring manual cleanup.

## Adding new integration tests

1. Create your test file under `tests/integration/volundr/` or
   `tests/integration/tyr/`.
2. Mark every test (or the module) with `@pytest.mark.integration`:

```python
import pytest

pytestmark = pytest.mark.integration

async def test_something(txn_pool, volundr_settings, auth_headers):
    # txn_pool is a TransactionalPool backed by a real database
    # All writes are rolled back after this test
    ...
```

3. Use the `txn_pool` fixture for database access — it provides the same
   interface as `asyncpg.Pool` (`acquire()`, `fetch()`, `fetchrow()`, etc.).
4. Use `volundr_settings` or `tyr_settings` to get a `Settings` object
   pointing at the test database.
5. Use `auth_headers(user_id, email, tenant, roles)` to generate Envoy-style
   auth header dicts for HTTP requests.

## Adding new Playwright tests

1. Create a `*.spec.ts` file under `web/e2e/`.
2. Use Playwright's `test` and `expect` from `@playwright/test`:

```typescript
import { test, expect } from '@playwright/test';

test('example user journey', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Niuu/);
});
```

3. Playwright is configured in `web/playwright.config.ts`:
   - Test directory: `web/e2e/`
   - Base URL: `http://localhost:5174`
   - Browser: Chromium only
   - Traces enabled on first retry

## Debugging tips

### Playwright trace viewer

When a Playwright test fails in CI, a trace is captured on the first retry.
Download the trace artifact and open it:

```bash
npx playwright show-trace trace.zip
```

The trace viewer shows a timeline of actions, screenshots, network requests,
and console logs.

### Playwright interactive UI

Run tests with the Playwright UI for step-through debugging:

```bash
make test-e2e-ui
```

### pytest output capture

By default pytest captures stdout/stderr. Pass `-s` to see live output:

```bash
uv run pytest tests/integration/ -v -s -m integration
```

### Running a single test

```bash
# By name
uv run pytest tests/integration/volundr/test_sessions.py::test_create_session -v -m integration

# By keyword
uv run pytest tests/integration/ -v -k "test_auth" -m integration
```
