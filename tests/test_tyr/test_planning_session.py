"""Tests for interactive planning sessions — domain service and REST API."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.adapters.memory_planning_repo import InMemoryPlanningSessionRepository
from tyr.api.planning import create_planning_router, resolve_planning_service
from tyr.config import PlannerConfig
from tyr.domain.models import (
    PlanningMessage,
    PlanningSession,
    PlanningSessionStatus,
)
from tyr.domain.services.planning_session import (
    InvalidPlanningStateError,
    PlanningSessionNotFoundError,
    PlanningSessionService,
    SessionLimitReachedError,
)
from tyr.domain.validation import ValidationError
from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

# ---------------------------------------------------------------------------
# Mock Volundr
# ---------------------------------------------------------------------------


class MockVolundr(VolundrPort):
    """Mock Volundr adapter for tests."""

    def __init__(self) -> None:
        self.spawn_calls: list[SpawnRequest] = []
        self.sent_messages: list[tuple[str, str]] = []
        self.fail_spawn = False

    async def spawn_session(self, request, *, auth_token=None):
        self.spawn_calls.append(request)
        if self.fail_spawn:
            raise ConnectionError("Volundr unreachable")
        return VolundrSession(
            id="volundr-sess-001",
            name=request.name,
            status="RUNNING",
            tracker_issue_id=None,
        )

    async def get_session(self, session_id, *, auth_token=None):
        return None

    async def list_sessions(self, *, auth_token=None):
        return []

    async def get_pr_status(self, session_id):
        raise NotImplementedError

    async def get_chronicle_summary(self, session_id):
        return ""

    async def send_message(self, session_id, message, *, auth_token=None):
        self.sent_messages.append((session_id, message))

    async def subscribe_activity(self):
        return
        yield  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Valid saga structure JSON for testing
# ---------------------------------------------------------------------------

VALID_STRUCTURE_JSON = json.dumps(
    {
        "name": "Auth Refactor",
        "phases": [
            {
                "name": "Phase 1: Foundation",
                "raids": [
                    {
                        "name": "Setup auth middleware",
                        "description": "Implement OAuth2 middleware for API routes",
                        "acceptance_criteria": ["All routes protected", "Token validation works"],
                        "declared_files": ["src/middleware/auth.py", "src/config.py"],
                        "estimate_hours": 4.0,
                        "confidence": 0.8,
                    }
                ],
            }
        ],
    }
)

INVALID_STRUCTURE_JSON = json.dumps({"name": "Bad"})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def planning_repo() -> InMemoryPlanningSessionRepository:
    return InMemoryPlanningSessionRepository()


@pytest.fixture
def volundr() -> MockVolundr:
    return MockVolundr()


@pytest.fixture
def event_bus() -> InMemoryEventBus:
    return InMemoryEventBus()


@pytest.fixture
def config() -> PlannerConfig:
    return PlannerConfig(max_sessions_per_user=2)


@pytest.fixture
def service(
    planning_repo: InMemoryPlanningSessionRepository,
    volundr: MockVolundr,
    config: PlannerConfig,
    event_bus: InMemoryEventBus,
) -> PlanningSessionService:
    return PlanningSessionService(planning_repo, volundr, config, event_bus=event_bus)


@pytest.fixture
def client(service: PlanningSessionService) -> TestClient:
    from types import SimpleNamespace

    from tyr.config import AuthConfig

    app = FastAPI()
    app.include_router(create_planning_router())
    app.dependency_overrides[resolve_planning_service] = lambda: service
    app.state.settings = SimpleNamespace(auth=AuthConfig(allow_anonymous_dev=True))
    return TestClient(app)


# ---------------------------------------------------------------------------
# Domain service tests
# ---------------------------------------------------------------------------


class TestPlanningSessionService:
    @pytest.mark.asyncio
    async def test_spawn_success(
        self,
        service: PlanningSessionService,
        volundr: MockVolundr,
    ):
        session = await service.spawn("user-1", "Build auth", "niuu/volundr")

        assert session.owner_id == "user-1"
        assert session.repo == "niuu/volundr"
        assert session.spec == "Build auth"
        assert session.status == PlanningSessionStatus.ACTIVE
        assert session.session_id == "volundr-sess-001"

        assert len(volundr.spawn_calls) == 1
        assert volundr.spawn_calls[0].model == "claude-opus-4-6"

    @pytest.mark.asyncio
    async def test_spawn_emits_event(
        self,
        service: PlanningSessionService,
        event_bus: InMemoryEventBus,
    ):
        q = event_bus.subscribe()
        await service.spawn("user-1", "Build auth", "niuu/volundr")

        event = q.get_nowait()
        assert event.event == "planning.session_spawned"
        assert event.owner_id == "user-1"

    @pytest.mark.asyncio
    async def test_spawn_limit_reached(
        self,
        service: PlanningSessionService,
    ):
        await service.spawn("user-1", "Spec 1", "repo1")
        await service.spawn("user-1", "Spec 2", "repo2")

        with pytest.raises(SessionLimitReachedError):
            await service.spawn("user-1", "Spec 3", "repo3")

    @pytest.mark.asyncio
    async def test_spawn_different_owners_no_limit(
        self,
        service: PlanningSessionService,
    ):
        await service.spawn("user-1", "Spec 1", "repo1")
        await service.spawn("user-1", "Spec 2", "repo2")

        # Different user should not be limited
        session = await service.spawn("user-2", "Spec 3", "repo3")
        assert session.owner_id == "user-2"

    @pytest.mark.asyncio
    async def test_spawn_volundr_failure(
        self,
        service: PlanningSessionService,
        volundr: MockVolundr,
        planning_repo: InMemoryPlanningSessionRepository,
    ):
        volundr.fail_spawn = True

        with pytest.raises(ConnectionError):
            await service.spawn("user-1", "Spec", "repo")

        # Session should be marked as FAILED
        sessions = await planning_repo.list_by_owner("user-1")
        assert len(sessions) == 1
        assert sessions[0].status == PlanningSessionStatus.FAILED

    @pytest.mark.asyncio
    async def test_send_message_success(
        self,
        service: PlanningSessionService,
        volundr: MockVolundr,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        msg = await service.send_message(session.id, "How about splitting phase 1?")

        assert msg.content == "How about splitting phase 1?"
        assert msg.sender == "user"
        assert len(volundr.sent_messages) == 1
        assert volundr.sent_messages[0] == ("volundr-sess-001", "How about splitting phase 1?")

    @pytest.mark.asyncio
    async def test_send_message_not_found(
        self,
        service: PlanningSessionService,
    ):
        with pytest.raises(PlanningSessionNotFoundError):
            await service.send_message(uuid4(), "hello")

    @pytest.mark.asyncio
    async def test_send_message_invalid_state(
        self,
        service: PlanningSessionService,
        planning_repo: InMemoryPlanningSessionRepository,
    ):
        session = await service.spawn("user-1", "Spec", "repo")

        # Force to COMPLETED state
        from dataclasses import replace

        completed = replace(session, status=PlanningSessionStatus.COMPLETED)
        await planning_repo.save(completed)

        with pytest.raises(InvalidPlanningStateError):
            await service.send_message(session.id, "hello")

    @pytest.mark.asyncio
    async def test_propose_structure_success(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        updated = await service.propose_structure(session.id, VALID_STRUCTURE_JSON)

        assert updated.status == PlanningSessionStatus.STRUCTURE_PROPOSED
        assert updated.structure is not None
        assert updated.structure.name == "Auth Refactor"
        assert len(updated.structure.phases) == 1
        assert len(updated.structure.phases[0].raids) == 1

    @pytest.mark.asyncio
    async def test_propose_structure_emits_event(
        self,
        service: PlanningSessionService,
        event_bus: InMemoryEventBus,
    ):
        q = event_bus.subscribe()
        session = await service.spawn("user-1", "Spec", "repo")

        # Drain the spawn event
        spawn_event = q.get_nowait()
        assert spawn_event.event == "planning.session_spawned"

        await service.propose_structure(session.id, VALID_STRUCTURE_JSON)

        event = q.get_nowait()
        assert event.event == "planning.structure_proposed"
        assert event.data["saga_name"] == "Auth Refactor"

    @pytest.mark.asyncio
    async def test_propose_structure_invalid_json(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")

        with pytest.raises(ValidationError):
            await service.propose_structure(session.id, INVALID_STRUCTURE_JSON)

    @pytest.mark.asyncio
    async def test_propose_structure_not_found(
        self,
        service: PlanningSessionService,
    ):
        with pytest.raises(PlanningSessionNotFoundError):
            await service.propose_structure(uuid4(), VALID_STRUCTURE_JSON)

    @pytest.mark.asyncio
    async def test_propose_structure_invalid_state(
        self,
        service: PlanningSessionService,
        planning_repo: InMemoryPlanningSessionRepository,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        from dataclasses import replace

        completed = replace(session, status=PlanningSessionStatus.COMPLETED)
        await planning_repo.save(completed)

        with pytest.raises(InvalidPlanningStateError):
            await service.propose_structure(session.id, VALID_STRUCTURE_JSON)

    @pytest.mark.asyncio
    async def test_re_propose_structure(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        await service.propose_structure(session.id, VALID_STRUCTURE_JSON)

        # Re-proposing in STRUCTURE_PROPOSED state should work
        updated = await service.propose_structure(session.id, VALID_STRUCTURE_JSON)
        assert updated.status == PlanningSessionStatus.STRUCTURE_PROPOSED

    @pytest.mark.asyncio
    async def test_complete_success(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        await service.propose_structure(session.id, VALID_STRUCTURE_JSON)
        completed = await service.complete(session.id)

        assert completed.status == PlanningSessionStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_complete_not_found(
        self,
        service: PlanningSessionService,
    ):
        with pytest.raises(PlanningSessionNotFoundError):
            await service.complete(uuid4())

    @pytest.mark.asyncio
    async def test_complete_without_structure(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")

        with pytest.raises(InvalidPlanningStateError):
            await service.complete(session.id)

    @pytest.mark.asyncio
    async def test_list_sessions(
        self,
        service: PlanningSessionService,
    ):
        await service.spawn("user-1", "Spec 1", "repo1")
        await service.spawn("user-1", "Spec 2", "repo2")
        await service.spawn("user-2", "Spec 3", "repo3")

        sessions = await service.list_sessions("user-1")
        assert len(sessions) == 2

        sessions = await service.list_sessions("user-2")
        assert len(sessions) == 1

    @pytest.mark.asyncio
    async def test_get_session(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        found = await service.get(session.id)
        assert found is not None
        assert found.id == session.id

    @pytest.mark.asyncio
    async def test_get_session_not_found(
        self,
        service: PlanningSessionService,
    ):
        found = await service.get(uuid4())
        assert found is None

    @pytest.mark.asyncio
    async def test_delete_session(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        deleted = await service.delete(session.id)
        assert deleted is True

        found = await service.get(session.id)
        assert found is None

    @pytest.mark.asyncio
    async def test_delete_session_not_found(
        self,
        service: PlanningSessionService,
    ):
        deleted = await service.delete(uuid4())
        assert deleted is False

    @pytest.mark.asyncio
    async def test_get_messages(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        await service.send_message(session.id, "msg 1")
        await service.send_message(session.id, "msg 2")

        messages = await service.get_messages(session.id)
        assert len(messages) == 2
        assert messages[0].content == "msg 1"
        assert messages[1].content == "msg 2"

    @pytest.mark.asyncio
    async def test_get_messages_not_found(
        self,
        service: PlanningSessionService,
    ):
        with pytest.raises(PlanningSessionNotFoundError):
            await service.get_messages(uuid4())

    @pytest.mark.asyncio
    async def test_cleanup_expired(
        self,
        service: PlanningSessionService,
    ):
        count = await service.cleanup_expired()
        assert count == 0

    @pytest.mark.asyncio
    async def test_send_message_in_structure_proposed_state(
        self,
        service: PlanningSessionService,
    ):
        session = await service.spawn("user-1", "Spec", "repo")
        await service.propose_structure(session.id, VALID_STRUCTURE_JSON)

        # Should still be able to send messages in STRUCTURE_PROPOSED state
        msg = await service.send_message(session.id, "Actually, change phase 1")
        assert msg.content == "Actually, change phase 1"


# ---------------------------------------------------------------------------
# In-memory repository tests
# ---------------------------------------------------------------------------


class TestInMemoryPlanningRepo:
    @pytest.mark.asyncio
    async def test_save_and_get(self, planning_repo: InMemoryPlanningSessionRepository):
        session = PlanningSession(
            id=uuid4(),
            owner_id="user-1",
            session_id="vs-001",
            repo="repo",
            spec="spec",
            status=PlanningSessionStatus.ACTIVE,
            structure=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        await planning_repo.save(session)
        found = await planning_repo.get(session.id)
        assert found is not None
        assert found.id == session.id

    @pytest.mark.asyncio
    async def test_get_by_volundr_id(self, planning_repo: InMemoryPlanningSessionRepository):
        session = PlanningSession(
            id=uuid4(),
            owner_id="user-1",
            session_id="vs-001",
            repo="repo",
            spec="spec",
            status=PlanningSessionStatus.ACTIVE,
            structure=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        await planning_repo.save(session)
        found = await planning_repo.get_by_volundr_id("vs-001")
        assert found is not None
        assert found.id == session.id

        not_found = await planning_repo.get_by_volundr_id("non-existent")
        assert not_found is None

    @pytest.mark.asyncio
    async def test_delete_removes_messages(self, planning_repo: InMemoryPlanningSessionRepository):
        session_id = uuid4()
        session = PlanningSession(
            id=session_id,
            owner_id="user-1",
            session_id="vs-001",
            repo="repo",
            spec="spec",
            status=PlanningSessionStatus.ACTIVE,
            structure=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        await planning_repo.save(session)
        msg = PlanningMessage(
            id=uuid4(),
            planning_session_id=session_id,
            content="test",
            sender="user",
            created_at=datetime.now(UTC),
        )
        await planning_repo.save_message(msg)

        await planning_repo.delete(session_id)
        assert await planning_repo.get(session_id) is None
        assert await planning_repo.get_messages(session_id) == []


# ---------------------------------------------------------------------------
# REST API tests
# ---------------------------------------------------------------------------


class TestPlanningAPI:
    def test_spawn_session(self, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Build auth system", "repo": "niuu/volundr"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "ACTIVE"
        assert data["session_id"] == "volundr-sess-001"
        assert data["repo"] == "niuu/volundr"

    def test_spawn_session_empty_spec(self, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "", "repo": "niuu/volundr"},
        )
        assert resp.status_code == 422

    def test_spawn_session_limit_reached(self, client: TestClient):
        client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec 1", "repo": "repo1"},
        )
        client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec 2", "repo": "repo2"},
        )
        resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec 3", "repo": "repo3"},
        )
        assert resp.status_code == 429

    def test_list_sessions(self, client: TestClient):
        client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec 1", "repo": "repo1"},
        )
        resp = client.get("/api/v1/tyr/planning/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1

    def test_get_session(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.get(f"/api/v1/tyr/planning/sessions/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == session_id

    def test_get_session_not_found(self, client: TestClient):
        resp = client.get(f"/api/v1/tyr/planning/sessions/{uuid4()}")
        assert resp.status_code == 404

    def test_send_message(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/messages",
            json={"content": "Split the auth phase"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "Split the auth phase"
        assert data["sender"] == "user"

    def test_send_message_not_found(self, client: TestClient):
        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{uuid4()}/messages",
            json={"content": "hello"},
        )
        assert resp.status_code == 404

    def test_send_message_empty_content(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/messages",
            json={"content": ""},
        )
        assert resp.status_code == 422

    def test_list_messages(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/messages",
            json={"content": "msg 1"},
        )
        client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/messages",
            json={"content": "msg 2"},
        )

        resp = client.get(f"/api/v1/tyr/planning/sessions/{session_id}/messages")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_list_messages_not_found(self, client: TestClient):
        resp = client.get(f"/api/v1/tyr/planning/sessions/{uuid4()}/messages")
        assert resp.status_code == 404

    def test_propose_structure(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/structure",
            json={"raw_json": VALID_STRUCTURE_JSON},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "STRUCTURE_PROPOSED"
        assert data["structure"] is not None
        assert data["structure"]["name"] == "Auth Refactor"

    def test_propose_structure_invalid(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/structure",
            json={"raw_json": INVALID_STRUCTURE_JSON},
        )
        assert resp.status_code == 422

    def test_propose_structure_not_found(self, client: TestClient):
        resp = client.post(
            f"/api/v1/tyr/planning/sessions/{uuid4()}/structure",
            json={"raw_json": VALID_STRUCTURE_JSON},
        )
        assert resp.status_code == 404

    def test_complete_session(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        client.post(
            f"/api/v1/tyr/planning/sessions/{session_id}/structure",
            json={"raw_json": VALID_STRUCTURE_JSON},
        )

        resp = client.post(f"/api/v1/tyr/planning/sessions/{session_id}/complete")
        assert resp.status_code == 200
        assert resp.json()["status"] == "COMPLETED"

    def test_complete_without_structure(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.post(f"/api/v1/tyr/planning/sessions/{session_id}/complete")
        assert resp.status_code == 409

    def test_complete_not_found(self, client: TestClient):
        resp = client.post(f"/api/v1/tyr/planning/sessions/{uuid4()}/complete")
        assert resp.status_code == 404

    def test_delete_session(self, client: TestClient):
        spawn_resp = client.post(
            "/api/v1/tyr/planning/sessions",
            json={"spec": "Spec", "repo": "repo"},
        )
        session_id = spawn_resp.json()["id"]

        resp = client.delete(f"/api/v1/tyr/planning/sessions/{session_id}")
        assert resp.status_code == 204

        resp = client.get(f"/api/v1/tyr/planning/sessions/{session_id}")
        assert resp.status_code == 404

    def test_delete_session_not_found(self, client: TestClient):
        resp = client.delete(f"/api/v1/tyr/planning/sessions/{uuid4()}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


class TestPlanningModels:
    def test_planning_session_status_values(self):
        assert PlanningSessionStatus.SPAWNING == "SPAWNING"
        assert PlanningSessionStatus.ACTIVE == "ACTIVE"
        assert PlanningSessionStatus.STRUCTURE_PROPOSED == "STRUCTURE_PROPOSED"
        assert PlanningSessionStatus.COMPLETED == "COMPLETED"
        assert PlanningSessionStatus.FAILED == "FAILED"
        assert PlanningSessionStatus.EXPIRED == "EXPIRED"

    def test_planning_session_frozen(self):
        session = PlanningSession(
            id=uuid4(),
            owner_id="user-1",
            session_id="vs-001",
            repo="repo",
            spec="spec",
            status=PlanningSessionStatus.ACTIVE,
            structure=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        with pytest.raises(AttributeError):
            session.status = PlanningSessionStatus.COMPLETED  # type: ignore[misc]

    def test_planning_message_frozen(self):
        msg = PlanningMessage(
            id=uuid4(),
            planning_session_id=uuid4(),
            content="hello",
            sender="user",
            created_at=datetime.now(UTC),
        )
        with pytest.raises(AttributeError):
            msg.content = "changed"  # type: ignore[misc]

    def test_planner_config_defaults(self):
        config = PlannerConfig()
        assert config.idle_timeout_seconds == 1800.0
        assert config.max_sessions_per_user == 3
        assert config.default_model == "claude-opus-4-6"
        assert len(config.system_prompt) > 0
