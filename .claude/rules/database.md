# Database Rules

## Raw SQL Only

- **NO ORM** — Do not use SQLAlchemy ORM, Django ORM, or any other ORM
- Use raw SQL queries with `asyncpg` for PostgreSQL
- SQL queries should be parameterized to prevent SQL injection

```python
# ✅ GOOD: Raw SQL with asyncpg
async def get_session(self, session_id: UUID) -> Session | None:
    row = await self._pool.fetchrow(
        "SELECT * FROM sessions WHERE id = $1",
        session_id
    )
    if row is None:
        return None
    return self._row_to_session(row)

# ❌ BAD: ORM usage
session = await Session.objects.get(id=session_id)
```

## Migrations

- Tables are auto-created on startup for development
- Production migrations use `migrate` (Kubernetes-native), NOT Alembic
- Schema changes should be backwards-compatible

## Testing

- **NO Docker** for database tests
- Use mocking/patching for `asyncpg` connection pools
- Create fake/stub implementations for unit tests
- Integration tests run against real PostgreSQL in CI only
