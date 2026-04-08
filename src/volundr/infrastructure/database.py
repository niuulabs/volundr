"""Database infrastructure for PostgreSQL."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import asyncpg

from volundr.config import DatabaseConfig

SESSIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    model VARCHAR(100) NOT NULL,
    repo VARCHAR(500) NOT NULL,
    branch VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    chat_endpoint TEXT,
    code_endpoint TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    message_count INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    pod_name VARCHAR(255),
    error TEXT
);
"""

CREATE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active);
"""

TOKEN_USAGE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS token_usage (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    tokens INTEGER NOT NULL,
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    cost NUMERIC(10, 6)
);
"""

TOKEN_USAGE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_token_usage_recorded_at ON token_usage(recorded_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider);
"""

CHRONICLES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS chronicles (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    project VARCHAR(255) NOT NULL,
    repo VARCHAR(500) NOT NULL,
    branch VARCHAR(255) NOT NULL,
    model VARCHAR(100) NOT NULL,
    config_snapshot JSONB NOT NULL DEFAULT '{}',
    summary TEXT,
    key_changes JSONB NOT NULL DEFAULT '[]',
    unfinished_work TEXT,
    token_usage INTEGER NOT NULL DEFAULT 0,
    cost NUMERIC(10, 6),
    duration_seconds INTEGER,
    tags TEXT[] NOT NULL DEFAULT '{}',
    parent_chronicle_id UUID REFERENCES chronicles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
"""

CHRONICLES_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_chronicles_session_id ON chronicles(session_id);
CREATE INDEX IF NOT EXISTS idx_chronicles_project ON chronicles(project);
CREATE INDEX IF NOT EXISTS idx_chronicles_repo ON chronicles(repo);
CREATE INDEX IF NOT EXISTS idx_chronicles_created_at ON chronicles(created_at);
CREATE INDEX IF NOT EXISTS idx_chronicles_tags ON chronicles USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_chronicles_parent_id ON chronicles(parent_chronicle_id);
"""

CHRONICLE_EVENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS chronicle_events (
    id UUID PRIMARY KEY,
    chronicle_id UUID NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL,
    label TEXT NOT NULL,
    tokens INTEGER,
    action VARCHAR(20),
    ins INTEGER,
    del INTEGER,
    hash VARCHAR(40),
    exit_code INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
"""

CHRONICLE_EVENTS_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_chronicle_events_chronicle_id ON chronicle_events(chronicle_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_events_session_id ON chronicle_events(session_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_events_t ON chronicle_events(t);
"""

SESSION_EVENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS session_events (
    id              UUID PRIMARY KEY,
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type      VARCHAR(30) NOT NULL,
    timestamp       TIMESTAMP WITH TIME ZONE NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost            NUMERIC(10, 6),
    duration_ms     INTEGER,
    model           VARCHAR(100),
    sequence        INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
"""

SESSION_EVENTS_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_session_events_session_id
    ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session_type
    ON session_events(session_id, event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_session_ts
    ON session_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_sequence
    ON session_events(session_id, sequence);
"""

TENANTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tenants (
    id              TEXT PRIMARY KEY,
    path            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    parent_id       TEXT REFERENCES tenants(id),
    tier            TEXT NOT NULL DEFAULT 'developer',
    max_sessions    INT NOT NULL DEFAULT 5,
    max_storage_gb  INT NOT NULL DEFAULT 50,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
"""

TENANTS_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_tenants_path ON tenants(path);
CREATE INDEX IF NOT EXISTS idx_tenants_parent_id ON tenants(parent_id);
"""

USERS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active',
    home_pvc        TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
"""

USERS_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
"""

TENANT_MEMBERSHIPS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tenant_memberships (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'volundr:developer',
    granted_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tenant_id)
);
"""

TENANT_MEMBERSHIPS_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON tenant_memberships(user_id);
"""

SESSIONS_IDENTITY_COLUMNS_SQL = """
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT;
"""

SESSIONS_IDENTITY_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_sessions_owner_id ON sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id);
"""


async def create_pool(config: DatabaseConfig) -> asyncpg.Pool:
    """Create an asyncpg connection pool."""
    return await asyncpg.create_pool(
        host=config.host,
        port=config.port,
        user=config.user,
        password=config.password,
        database=config.name,
        min_size=config.min_pool_size,
        max_size=config.max_pool_size,
    )


async def init_db(pool: asyncpg.Pool) -> None:
    """Initialize database schema (create tables if not exist).

    Note: Schema migrations are handled by the migrate init container.
    This function only creates tables if they don't exist (for development).
    """
    async with pool.acquire() as conn:
        await conn.execute(SESSIONS_TABLE_SQL)
        await conn.execute(CREATE_INDEX_SQL)
        await conn.execute(TOKEN_USAGE_TABLE_SQL)
        await conn.execute(TOKEN_USAGE_INDEX_SQL)
        await conn.execute(CHRONICLES_TABLE_SQL)
        await conn.execute(CHRONICLES_INDEX_SQL)
        await conn.execute(CHRONICLE_EVENTS_TABLE_SQL)
        await conn.execute(CHRONICLE_EVENTS_INDEX_SQL)
        await conn.execute(SESSION_EVENTS_TABLE_SQL)
        await conn.execute(SESSION_EVENTS_INDEX_SQL)
        # Identity tables (must come before FK columns on sessions)
        await conn.execute(TENANTS_TABLE_SQL)
        await conn.execute(TENANTS_INDEX_SQL)
        await conn.execute(USERS_TABLE_SQL)
        await conn.execute(USERS_INDEX_SQL)
        await conn.execute(TENANT_MEMBERSHIPS_TABLE_SQL)
        await conn.execute(TENANT_MEMBERSHIPS_INDEX_SQL)
        await conn.execute(SESSIONS_IDENTITY_COLUMNS_SQL)
        await conn.execute(SESSIONS_IDENTITY_INDEX_SQL)


@asynccontextmanager
async def database_pool(config: DatabaseConfig) -> AsyncGenerator[asyncpg.Pool, None]:
    """Context manager for database pool lifecycle."""
    pool = await create_pool(config)
    try:
        await init_db(pool)
        yield pool
    finally:
        await pool.close()
