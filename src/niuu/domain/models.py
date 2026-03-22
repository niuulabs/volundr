"""Shared domain models for Niuu modules."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

LINEAR_API_URL = "https://api.linear.app/graphql"


@dataclass(frozen=True)
class Principal:
    """Authenticated identity extracted from JWT."""

    user_id: str
    email: str
    tenant_id: str
    roles: list[str]


class IntegrationType(StrEnum):
    """Category of integration."""

    SOURCE_CONTROL = "source_control"
    ISSUE_TRACKER = "issue_tracker"
    MESSAGING = "messaging"
    AI_PROVIDER = "ai_provider"


@dataclass(frozen=True)
class IntegrationConnection:
    """A configured integration connection (e.g., issue tracker)."""

    id: str
    user_id: str
    integration_type: IntegrationType
    adapter: str  # fully-qualified class path
    credential_name: str  # reference to stored credential
    config: dict  # adapter-specific config
    enabled: bool
    created_at: datetime
    updated_at: datetime
    slug: str = ""  # references IntegrationDefinition.slug


class SecretType(StrEnum):
    """Type of stored credential."""

    API_KEY = "api_key"
    OAUTH_TOKEN = "oauth_token"
    GIT_CREDENTIAL = "git_credential"
    SSH_KEY = "ssh_key"
    TLS_CERT = "tls_cert"
    GENERIC = "generic"


@dataclass(frozen=True)
class StoredCredential:
    """Metadata for a stored credential (never contains secret values)."""

    id: str
    name: str
    secret_type: SecretType
    keys: tuple[str, ...]
    metadata: dict
    owner_id: str
    owner_type: str  # "user" | "tenant"
    created_at: datetime
    updated_at: datetime


class CacheEntry:
    """Simple TTL cache entry."""

    __slots__ = ("value", "expires_at")

    def __init__(self, value: object, ttl: float) -> None:
        self.value = value
        self.expires_at = time.monotonic() + ttl

    @property
    def expired(self) -> bool:
        return time.monotonic() >= self.expires_at
