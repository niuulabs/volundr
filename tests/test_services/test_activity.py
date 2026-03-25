"""Tests for session activity state updates."""

from __future__ import annotations

import pytest

from volundr.domain.models import (
    EventType,
    GitSource,
    SessionActivityState,
)
from volundr.domain.services import SessionService
from volundr.domain.services.session import SessionNotFoundError


class TestUpdateActivity:
    """Tests for SessionService.update_activity."""

    @pytest.fixture
    def service(self, repository, pod_manager, broadcaster):
        return SessionService(
            repository=repository,
            pod_manager=pod_manager,
            broadcaster=broadcaster,
            provisioning_initial_delay=0,
            provisioning_timeout=1.0,
        )

    @pytest.fixture
    def service_no_broadcaster(self, repository, pod_manager):
        return SessionService(
            repository=repository,
            pod_manager=pod_manager,
            broadcaster=None,
            provisioning_initial_delay=0,
            provisioning_timeout=1.0,
        )

    @pytest.mark.asyncio
    async def test_update_activity_sets_state(self, service, broadcaster):
        """update_activity should set activity_state and metadata on the session."""
        session = await service.create_session(
            name="Test",
            model="claude-sonnet-4-20250514",
            source=GitSource(repo="https://github.com/test/repo", branch="main"),
        )

        metadata = {"turn_count": 3, "duration_seconds": 45}
        updated = await service.update_activity(session.id, SessionActivityState.IDLE, metadata)

        assert updated.activity_state == SessionActivityState.IDLE
        assert updated.activity_metadata == metadata

    @pytest.mark.asyncio
    async def test_update_activity_broadcasts_event(self, service, broadcaster):
        """update_activity should broadcast a SESSION_ACTIVITY event."""
        session = await service.create_session(
            name="Test",
            model="claude-sonnet-4-20250514",
            source=GitSource(repo="https://github.com/test/repo", branch="main"),
        )

        broadcaster._events.clear()

        await service.update_activity(
            session.id,
            SessionActivityState.ACTIVE,
            {"turn_count": 1},
        )

        activity_events = [e for e in broadcaster._events if e.type == EventType.SESSION_ACTIVITY]
        assert len(activity_events) == 1
        assert activity_events[0].data["state"] == "active"
        assert activity_events[0].data["session_id"] == str(session.id)

    @pytest.mark.asyncio
    async def test_update_activity_not_found(self, service):
        """update_activity should raise SessionNotFoundError for missing session."""
        from uuid import uuid4

        with pytest.raises(SessionNotFoundError):
            await service.update_activity(uuid4(), SessionActivityState.IDLE, {})

    @pytest.mark.asyncio
    async def test_update_activity_without_broadcaster(self, service_no_broadcaster, repository):
        """update_activity should work without a broadcaster (no crash)."""
        session = await service_no_broadcaster.create_session(
            name="Test",
            model="claude-sonnet-4-20250514",
            source=GitSource(repo="https://github.com/test/repo", branch="main"),
        )

        updated = await service_no_broadcaster.update_activity(
            session.id,
            SessionActivityState.TOOL_EXECUTING,
            {"turn_count": 2},
        )

        assert updated.activity_state == SessionActivityState.TOOL_EXECUTING

    @pytest.mark.asyncio
    async def test_update_activity_transitions(self, service, broadcaster):
        """update_activity should correctly transition between states."""
        session = await service.create_session(
            name="Test",
            model="claude-sonnet-4-20250514",
            source=GitSource(repo="https://github.com/test/repo", branch="main"),
        )

        # Start active
        updated = await service.update_activity(
            session.id, SessionActivityState.ACTIVE, {"turn_count": 1}
        )
        assert updated.activity_state == SessionActivityState.ACTIVE

        # Transition to tool_executing
        updated = await service.update_activity(
            session.id, SessionActivityState.TOOL_EXECUTING, {"turn_count": 1}
        )
        assert updated.activity_state == SessionActivityState.TOOL_EXECUTING

        # Transition to idle
        updated = await service.update_activity(
            session.id, SessionActivityState.IDLE, {"turn_count": 2}
        )
        assert updated.activity_state == SessionActivityState.IDLE


class TestSessionActivityState:
    """Tests for the SessionActivityState enum."""

    def test_values(self) -> None:
        assert SessionActivityState.ACTIVE == "active"
        assert SessionActivityState.IDLE == "idle"
        assert SessionActivityState.TOOL_EXECUTING == "tool_executing"

    def test_from_string(self) -> None:
        assert SessionActivityState("active") == SessionActivityState.ACTIVE
        assert SessionActivityState("idle") == SessionActivityState.IDLE
        assert SessionActivityState("tool_executing") == SessionActivityState.TOOL_EXECUTING

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError):
            SessionActivityState("invalid")
