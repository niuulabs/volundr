"""Service for forge profile CRUD operations."""

from __future__ import annotations

import logging
import re

from volundr.domain.models import ForgeProfile, SessionStatus
from volundr.domain.ports import MutableProfileProvider, ProfileProvider, SessionRepository

logger = logging.getLogger(__name__)


class ProfileNotFoundError(Exception):
    """Raised when a requested profile does not exist."""


class ProfileReadOnlyError(Exception):
    """Raised when a write operation is attempted on a read-only provider."""


class ProfileValidationError(Exception):
    """Raised when profile data fails validation."""


_MEMORY_RE = re.compile(
    r"^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)$"
)

_MEMORY_LIMITS = {
    "Ki": (512 * 1024, 64 * 1024 * 1024),  # 512Ki .. 64Ti (in Ki)
    "Mi": (512, 64 * 1024),                 # 512Mi .. 64Gi (in Mi)
    "Gi": (0.5, 64),                        # 0.5Gi .. 64Gi
    "Ti": (0.0005, 64),                     # tiny .. 64Ti
}


def validate_profile(profile: ForgeProfile) -> list[str]:
    """Validate a ForgeProfile and return a list of error messages.

    Returns an empty list if the profile is valid.
    """
    errors: list[str] = []

    # Resource config validation
    rc = profile.resource_config
    if rc:
        cpu = rc.get("cpu")
        if cpu is not None:
            try:
                cpu_val = float(cpu)
                if cpu_val < 0.5 or cpu_val > 16:
                    errors.append(
                        f"resource_config.cpu must be between 0.5 and 16, got {cpu_val}"
                    )
            except (TypeError, ValueError):
                errors.append(
                    f"resource_config.cpu must be a number, got {cpu!r}"
                )

        memory = rc.get("memory")
        if memory is not None:
            m = _MEMORY_RE.match(str(memory))
            if m is None:
                errors.append(
                    f"resource_config.memory must match format like '512Mi' or '2Gi', "
                    f"got {memory!r}"
                )
            else:
                val = float(m.group(1))
                unit = m.group(2)
                lo, hi = _MEMORY_LIMITS[unit]
                if val < lo or val > hi:
                    errors.append(
                        f"resource_config.memory {memory} is out of range "
                        f"({lo}{unit}..{hi}{unit})"
                    )

        gpu = rc.get("gpu")
        if gpu is not None:
            try:
                gpu_val = int(gpu)
                if gpu_val < 0 or gpu_val > 4:
                    errors.append(
                        f"resource_config.gpu must be between 0 and 4, got {gpu_val}"
                    )
            except (TypeError, ValueError):
                errors.append(
                    f"resource_config.gpu must be an integer, got {gpu!r}"
                )

    # Model must be non-empty if provided
    if profile.model is not None and len(profile.model.strip()) == 0:
        errors.append("model must be a non-empty string when provided")

    # MCP server configs must have type field
    for i, mcp in enumerate(profile.mcp_servers):
        if "type" not in mcp:
            errors.append(f"mcp_servers[{i}] must have a 'type' field")

    # Image reference in workload_config must be non-empty if provided
    wc = profile.workload_config
    if wc:
        image = wc.get("image")
        if image is not None and len(str(image).strip()) == 0:
            errors.append("workload_config.image must be non-empty when provided")

    return errors


class ForgeProfileService:
    """Service for forge profile CRUD operations.

    Supports both read-only and mutable profile providers. Write
    operations require a MutableProfileProvider; otherwise
    ProfileReadOnlyError is raised.
    """

    def __init__(
        self,
        provider: ProfileProvider,
        session_repository: SessionRepository | None = None,
    ):
        self._provider = provider
        self._session_repository = session_repository

    @property
    def _mutable(self) -> MutableProfileProvider:
        """Return the provider as MutableProfileProvider or raise."""
        if not isinstance(self._provider, MutableProfileProvider):
            raise ProfileReadOnlyError(
                "Profile provider is read-only; write operations are not supported"
            )
        return self._provider

    def get_profile(self, name: str) -> ForgeProfile | None:
        """Get a profile by name."""
        return self._provider.get(name)

    def list_profiles(self, workload_type: str | None = None) -> list[ForgeProfile]:
        """List all profiles, optionally filtered by workload type."""
        return self._provider.list(workload_type=workload_type)

    def get_default(self, workload_type: str) -> ForgeProfile | None:
        """Get the default profile for a workload type."""
        return self._provider.get_default(workload_type)

    async def create_profile(self, profile: ForgeProfile) -> ForgeProfile:
        """Create a new profile.

        Raises:
            ProfileReadOnlyError: If the provider does not support writes.
            ProfileValidationError: If the profile data is invalid.
            ValueError: If a profile with the same name already exists.
        """
        errors = validate_profile(profile)
        if errors:
            raise ProfileValidationError("; ".join(errors))

        return await self._mutable.create(profile)

    async def update_profile(self, name: str, profile: ForgeProfile) -> ForgeProfile:
        """Update an existing profile.

        Raises:
            ProfileNotFoundError: If the profile does not exist.
            ProfileReadOnlyError: If the provider does not support writes.
            ProfileValidationError: If the profile data is invalid.
        """
        existing = self._provider.get(name)
        if existing is None:
            raise ProfileNotFoundError(f"Profile not found: {name}")

        errors = validate_profile(profile)
        if errors:
            raise ProfileValidationError("; ".join(errors))

        return await self._mutable.update(name, profile)

    async def delete_profile(self, name: str) -> bool:
        """Delete a profile by name.

        Raises:
            ProfileNotFoundError: If the profile does not exist.
            ProfileReadOnlyError: If the provider does not support writes.
            ValueError: If the profile is currently in use by running sessions.
        """
        existing = self._provider.get(name)
        if existing is None:
            raise ProfileNotFoundError(f"Profile not found: {name}")

        # Check if any running sessions use this profile
        if self._session_repository is not None:
            sessions = await self._session_repository.list()
            in_use = [
                s for s in sessions
                if s.status == SessionStatus.RUNNING and s.name == name
            ]
            if in_use:
                raise ValueError(
                    f"Cannot delete profile '{name}': in use by "
                    f"{len(in_use)} running session(s)"
                )

        return await self._mutable.delete(name)
