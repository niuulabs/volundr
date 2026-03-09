"""Tests for ForgeProfileService."""

from __future__ import annotations

import pytest

from volundr.domain.models import ForgeProfile
from volundr.domain.ports import ProfileProvider
from volundr.domain.services.profile import ForgeProfileService


class InMemoryProfileProvider(ProfileProvider):
    """In-memory profile provider for testing."""

    def __init__(self, profiles: list[ForgeProfile] | None = None):
        self._profiles: dict[str, ForgeProfile] = {}
        for p in profiles or []:
            self._profiles[p.name] = p

    def get(self, name: str) -> ForgeProfile | None:
        return self._profiles.get(name)

    def list(self, workload_type: str | None = None) -> list[ForgeProfile]:
        profiles = list(self._profiles.values())
        if workload_type is not None:
            profiles = [p for p in profiles if p.workload_type == workload_type]
        return sorted(profiles, key=lambda p: p.name)

    def get_default(self, workload_type: str) -> ForgeProfile | None:
        for p in self._profiles.values():
            if p.workload_type == workload_type and p.is_default:
                return p
        return None


@pytest.fixture
def sample_profiles() -> list[ForgeProfile]:
    """Create sample forge profiles."""
    return [
        ForgeProfile(
            name="standard",
            description="Standard coding session",
            workload_type="session",
            model="claude-sonnet-4",
            system_prompt="You are helpful.",
            resource_config={"cpu": "500m", "memory": "1Gi"},
            mcp_servers=[{"name": "fs", "command": "mcp-fs"}],
            env_vars={"MY_VAR": "value"},
            env_secret_refs=["secret-1"],
            workload_config={"timeout": 300},
            is_default=True,
        ),
        ForgeProfile(
            name="gpu-heavy",
            description="GPU workspace",
            workload_type="session",
            model="claude-opus-4",
            resource_config={"cpu": "2", "memory": "8Gi"},
            is_default=False,
        ),
        ForgeProfile(
            name="ovas-worker",
            description="OVAS background worker",
            workload_type="ovas",
        ),
    ]


@pytest.fixture
def profile_provider(sample_profiles) -> InMemoryProfileProvider:
    """Create an in-memory profile provider."""
    return InMemoryProfileProvider(sample_profiles)


@pytest.fixture
def profile_service(profile_provider: InMemoryProfileProvider) -> ForgeProfileService:
    """Create a profile service with test doubles."""
    return ForgeProfileService(provider=profile_provider)


class TestGetProfile:
    """Tests for ForgeProfileService.get_profile."""

    def test_get_profile(self, profile_service: ForgeProfileService):
        """Getting an existing profile returns it."""
        result = profile_service.get_profile("standard")

        assert result is not None
        assert result.name == "standard"
        assert result.workload_type == "session"
        assert result.model == "claude-sonnet-4"
        assert result.description == "Standard coding session"

    def test_get_profile_not_found(self, profile_service: ForgeProfileService):
        """Getting a nonexistent profile returns None."""
        result = profile_service.get_profile("nonexistent")
        assert result is None


class TestListProfiles:
    """Tests for ForgeProfileService.list_profiles."""

    def test_list_profiles(self, profile_service: ForgeProfileService):
        """Listing profiles returns all profiles sorted by name."""
        result = profile_service.list_profiles()

        assert len(result) == 3
        names = [p.name for p in result]
        assert names == ["gpu-heavy", "ovas-worker", "standard"]

    def test_list_profiles_filtered_by_workload_type(self, profile_service: ForgeProfileService):
        """Listing profiles filtered by workload type returns matching profiles."""
        result = profile_service.list_profiles(workload_type="session")

        assert len(result) == 2
        names = {p.name for p in result}
        assert names == {"standard", "gpu-heavy"}

    def test_list_profiles_no_match(self, profile_service: ForgeProfileService):
        """Listing profiles with unknown workload type returns empty."""
        result = profile_service.list_profiles(workload_type="unknown")
        assert result == []

    def test_list_profiles_empty_provider(self):
        """Listing profiles from empty provider returns empty list."""
        service = ForgeProfileService(provider=InMemoryProfileProvider())
        result = service.list_profiles()
        assert result == []


class TestGetDefault:
    """Tests for ForgeProfileService.get_default."""

    def test_get_default(self, profile_service: ForgeProfileService):
        """Getting default profile returns the one marked is_default."""
        result = profile_service.get_default("session")

        assert result is not None
        assert result.name == "standard"
        assert result.is_default is True

    def test_get_default_no_default(self, profile_service: ForgeProfileService):
        """Getting default when none is marked returns None."""
        result = profile_service.get_default("ovas")
        assert result is None

    def test_get_default_unknown_type(self, profile_service: ForgeProfileService):
        """Getting default for unknown type returns None."""
        result = profile_service.get_default("unknown")
        assert result is None


class TestForgeProfileSessionDefinition:
    """Tests for ForgeProfile.session_definition field."""

    def test_session_definition_defaults_to_none(self):
        """ForgeProfile.session_definition is None by default."""
        profile = ForgeProfile(name="test")
        assert profile.session_definition is None

    def test_session_definition_can_be_set(self):
        """ForgeProfile.session_definition accepts a string value."""
        profile = ForgeProfile(name="codex-profile", session_definition="skuld-codex")
        assert profile.session_definition == "skuld-codex"

    def test_session_definition_claude(self):
        """ForgeProfile.session_definition can reference skuld-claude."""
        profile = ForgeProfile(name="claude-profile", session_definition="skuld-claude")
        assert profile.session_definition == "skuld-claude"
