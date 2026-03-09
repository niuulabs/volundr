"""Configuration-driven adapter for forge profiles.

Profiles are loaded from YAML config (or Kubernetes CRDs in future)
rather than stored in a database. Supports runtime mutations via
the MutableProfileProvider interface.
"""

from __future__ import annotations

from volundr.config import ProfileConfig
from volundr.domain.models import ForgeProfile
from volundr.domain.ports import MutableProfileProvider


class ConfigProfileProvider(MutableProfileProvider):
    """Reads forge profiles from application configuration.

    Also supports runtime create/update/delete for profiles added
    via the REST API. Config-loaded and runtime profiles live in the
    same dict; there is no distinction at query time.
    """

    def __init__(self, configs: list[ProfileConfig]):
        self._profiles: dict[str, ForgeProfile] = {}
        for cfg in configs:
            self._profiles[cfg.name] = ForgeProfile(
                name=cfg.name,
                description=cfg.description,
                workload_type=cfg.workload_type,
                model=cfg.model,
                system_prompt=cfg.system_prompt,
                resource_config=cfg.resource_config,
                mcp_servers=cfg.mcp_servers,
                env_vars=cfg.env_vars,
                env_secret_refs=cfg.env_secret_refs,
                workload_config=cfg.workload_config,
                is_default=cfg.is_default,
                session_definition=cfg.session_definition,
            )

    def get(self, name: str) -> ForgeProfile | None:
        """Retrieve a profile by name."""
        return self._profiles.get(name)

    def list(self, workload_type: str | None = None) -> list[ForgeProfile]:
        """List all profiles, optionally filtered by workload type."""
        profiles = list(self._profiles.values())
        if workload_type is not None:
            profiles = [p for p in profiles if p.workload_type == workload_type]
        return sorted(profiles, key=lambda p: p.name)

    def get_default(self, workload_type: str) -> ForgeProfile | None:
        """Get the default profile for a workload type."""
        for p in self._profiles.values():
            if p.workload_type == workload_type and p.is_default:
                return p
        return None

    async def create(self, profile: ForgeProfile) -> ForgeProfile:
        """Create a new profile."""
        if profile.name in self._profiles:
            raise ValueError(f"Profile already exists: {profile.name}")
        self._profiles[profile.name] = profile
        return profile

    async def update(self, name: str, profile: ForgeProfile) -> ForgeProfile:
        """Update an existing profile."""
        if name not in self._profiles:
            raise ValueError(f"Profile not found: {name}")
        # If name changed, remove old entry
        if name != profile.name:
            del self._profiles[name]
        self._profiles[profile.name] = profile
        return profile

    async def delete(self, name: str) -> bool:
        """Delete a profile by name."""
        if name not in self._profiles:
            return False
        del self._profiles[name]
        return True
