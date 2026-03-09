"""Tests for Farm Tasks Service pod manager adapter.

Tests against the nv.svc.farm-tasks v0.13.4 API.
"""

import json
from uuid import uuid4

import httpx
import pytest
import respx

from tests.conftest import make_spec
from volundr.adapters.outbound.farm import FarmApiError, FarmPodManager
from volundr.domain.models import Session, SessionStatus

# A fixed Farm-assigned task_id to use in tests (distinct from session_id)
FARM_TASK_ID = "f94e02f2-0dab-4869-9386-7370428fa47f"


def _task_entry(session: Session, farm_task_id: str = FARM_TASK_ID) -> dict:
    """Build a single Farm task entry matching the session."""
    return {
        "task_id": farm_task_id,
        "task_args": {
            "session": {
                "id": str(session.id),
                "name": session.name,
                "model": session.model,
            },
        },
    }


def _task_list_response(session: Session, farm_task_id: str = FARM_TASK_ID) -> dict:
    """Build a Farm /tasks/list response containing one task matching the session."""
    return {
        "('skuld', '')": [_task_entry(session, farm_task_id)],
    }


def _mock_task_list(session: Session, farm_task_id: str = FARM_TASK_ID) -> respx.Route:
    """Register a respx mock for the task list endpoint returning one matching task."""
    return respx.get("https://farm.example.com/queue/management/tasks/list").respond(
        status_code=200,
        json=_task_list_response(session, farm_task_id),
    )


def _mock_task_list_empty() -> respx.Route:
    """Register a respx mock for the task list endpoint returning no tasks."""
    return respx.get("https://farm.example.com/queue/management/tasks/list").respond(
        status_code=200,
        json={},
    )


@pytest.fixture
def sample_session() -> Session:
    """Create a sample session for testing."""
    return Session(
        id=uuid4(),
        name="Test Session",
        model="claude-sonnet-4-20250514",
        repo="https://github.com/org/repo",
        branch="main",
    )


@pytest.fixture
def pod_manager() -> FarmPodManager:
    """Create a FarmPodManager for testing (kwargs-based constructor)."""
    return FarmPodManager(
        base_url="https://farm.example.com",
        token="test-token",
        timeout=10.0,
        task_type="skuld-claude",
        user="volundr-test",
        labels=["volundr", "test"],
        base_domain="volundr.example.com",
        chat_scheme="wss",
        code_scheme="https",
    )




class TestFarmPodManagerStart:
    """Tests for start method (POST /queue/management/tasks/submit)."""

    @respx.mock
    async def test_start_calls_farm_submit_api(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that start calls Farm Tasks submit endpoint."""
        route = respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=200,
            json={"task_id": str(sample_session.id)},
        )

        spec = make_spec(session={"id": str(sample_session.id)})
        await pod_manager.start(sample_session, spec)

        assert route.called
        request = route.calls.last.request
        assert request.headers["Authorization"] == "Bearer test-token"

    @respx.mock
    async def test_start_returns_endpoints(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that start returns chat and code endpoints using session name."""
        respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=200,
            json={"task_id": str(sample_session.id)},
        )

        spec = make_spec()
        result = await pod_manager.start(sample_session, spec)

        session_id = str(sample_session.id)
        session_name = sample_session.name
        assert result.chat_endpoint == f"wss://{session_name}.volundr.example.com/session"
        assert result.code_endpoint == f"https://{session_name}.volundr.example.com/"
        assert result.pod_name == f"volundr-{session_id}"

    @respx.mock
    async def test_start_sends_spec_values_as_task_args(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that start sends spec.values as task_args."""
        route = respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=200,
            json={"task_id": str(sample_session.id)},
        )

        spec = make_spec(
            session={
                "id": str(sample_session.id),
                "name": sample_session.name,
                "model": sample_session.model,
            },
            ingress={"host": f"{sample_session.name}.volundr.example.com"},
        )
        await pod_manager.start(sample_session, spec)

        request = route.calls.last.request
        payload = json.loads(request.content)

        # Verify TaskSubmissionModel fields
        assert payload["task_type"] == "skuld-claude"
        assert payload["user"] == "volundr-test"
        assert payload["task_id"] == str(sample_session.id)
        assert payload["labels"] == ["volundr", "test"]

        # Verify spec values passed through as task_args
        assert payload["task_args"]["session"]["id"] == str(sample_session.id)
        assert payload["task_args"]["session"]["model"] == sample_session.model
        assert payload["task_args"]["ingress"]["host"] == (
            f"{sample_session.name}.volundr.example.com"
        )

    @respx.mock
    async def test_start_raises_on_api_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that start raises FarmApiError on API failure."""
        respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=500,
            text="Internal Server Error",
        )

        spec = make_spec()
        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.start(sample_session, spec)

        assert exc_info.value.status_code == 500
        assert "Internal Server Error" in exc_info.value.message

    @respx.mock
    async def test_start_raises_on_validation_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that start raises FarmApiError on 422 validation error."""
        respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=422,
            json={
                "detail": [
                    {"loc": ["body", "task_type"], "msg": "field required", "type": "value_error"}
                ]
            },
        )

        spec = make_spec()
        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.start(sample_session, spec)

        assert exc_info.value.status_code == 422

    @respx.mock
    async def test_start_passes_spec_values_directly(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that spec values are passed directly as task_args."""
        route = respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=200,
            json={"task_id": str(sample_session.id)},
        )

        spec = make_spec(custom_key="custom_value", nested={"a": 1})
        await pod_manager.start(sample_session, spec)

        request = route.calls.last.request
        payload = json.loads(request.content)

        assert payload["task_args"]["custom_key"] == "custom_value"
        assert payload["task_args"]["nested"] == {"a": 1}


class TestResolveFarmTaskId:
    """Tests for _resolve_farm_task_id helper."""

    @respx.mock
    async def test_resolves_task_id_from_task_list(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test resolving Farm task_id from task list by matching session ID."""
        _mock_task_list(sample_session)

        result = await pod_manager._resolve_farm_task_id(str(sample_session.id))

        assert result == FARM_TASK_ID

    @respx.mock
    async def test_returns_none_when_no_matching_task(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test returns None when no task matches the session ID."""
        _mock_task_list_empty()

        result = await pod_manager._resolve_farm_task_id(str(sample_session.id))

        assert result is None

    @respx.mock
    async def test_returns_none_on_api_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test returns None when task list API returns an error."""
        respx.get("https://farm.example.com/queue/management/tasks/list").respond(
            status_code=500,
            text="Internal Server Error",
        )

        result = await pod_manager._resolve_farm_task_id(str(sample_session.id))

        assert result is None

    @respx.mock
    async def test_finds_correct_task_among_multiple_in_same_group(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test finding the correct task when multiple tasks exist in the same group."""
        other_session_id = str(uuid4())
        respx.get("https://farm.example.com/queue/management/tasks/list").respond(
            status_code=200,
            json={
                "('skuld', '')": [
                    {
                        "task_id": "other-task-id",
                        "task_args": {
                            "session": {"id": other_session_id, "name": "Other", "model": "gpt-4"},
                        },
                    },
                    _task_entry(sample_session),
                ],
            },
        )

        result = await pod_manager._resolve_farm_task_id(str(sample_session.id))

        assert result == FARM_TASK_ID

    @respx.mock
    async def test_finds_task_across_groups(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test finding the correct task when it's in a different group."""
        respx.get("https://farm.example.com/queue/management/tasks/list").respond(
            status_code=200,
            json={
                "('other-type', '')": [
                    {
                        "task_id": "other-task-id",
                        "task_args": {
                            "session": {"id": str(uuid4()), "name": "Other", "model": "gpt-4"},
                        },
                    },
                ],
                "('skuld', '')": [_task_entry(sample_session)],
            },
        )

        result = await pod_manager._resolve_farm_task_id(str(sample_session.id))

        assert result == FARM_TASK_ID

    @respx.mock
    async def test_sends_status_and_field_params(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that task list request sends status and field query params."""
        route = _mock_task_list(sample_session)

        await pod_manager._resolve_farm_task_id(str(sample_session.id))

        request = route.calls.last.request
        params = str(request.url.params)
        assert "status=" in params
        assert "field=task_id" in params
        assert "field=task_args" in params


class TestFarmPodManagerStop:
    """Tests for stop method (POST /queue/management/tasks/cancel)."""

    @respx.mock
    async def test_stop_calls_farm_cancel_api(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop calls Farm Tasks cancel endpoint with resolved task_id."""
        _mock_task_list(sample_session)
        route = respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=200,
            json={},
        )

        await pod_manager.stop(sample_session)

        assert route.called

    @respx.mock
    async def test_stop_sends_resolved_farm_task_id(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop sends the Farm-assigned task_id, not session_id."""
        _mock_task_list(sample_session)
        route = respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=200,
            json={},
        )

        await pod_manager.stop(sample_session)

        request = route.calls.last.request
        payload = json.loads(request.content)

        assert payload["task_id"] == FARM_TASK_ID
        assert payload["task_id"] != str(sample_session.id)
        assert payload["userid"] == "volundr-test"

    @respx.mock
    async def test_stop_returns_true_on_success(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop returns True when task cancelled."""
        _mock_task_list(sample_session)
        respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=200,
            json={},
        )

        result = await pod_manager.stop(sample_session)

        assert result is True

    @respx.mock
    async def test_stop_returns_false_when_task_not_resolved(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop returns False when no matching Farm task found."""
        _mock_task_list_empty()

        result = await pod_manager.stop(sample_session)

        assert result is False

    @respx.mock
    async def test_stop_returns_false_when_not_found(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop returns False when cancel returns 404."""
        _mock_task_list(sample_session)
        respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=404,
            json={"detail": "Task not found"},
        )

        result = await pod_manager.stop(sample_session)

        assert result is False

    @respx.mock
    async def test_stop_returns_false_on_500_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop returns False on 500 error (task not found in Farm)."""
        _mock_task_list(sample_session)
        respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=500,
            text="Internal Server Error",
        )

        result = await pod_manager.stop(sample_session)

        assert result is False

    @respx.mock
    async def test_stop_raises_on_other_4xx_errors(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop raises FarmApiError on 4xx errors (except 404)."""
        _mock_task_list(sample_session)
        respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=403,
            text="Forbidden",
        )

        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.stop(sample_session)

        assert exc_info.value.status_code == 403

    @respx.mock
    async def test_stop_raises_on_502_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that stop raises FarmApiError on 502 (bad gateway) errors."""
        _mock_task_list(sample_session)
        respx.post("https://farm.example.com/queue/management/tasks/cancel").respond(
            status_code=502,
            text="Bad Gateway",
        )

        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.stop(sample_session)

        assert exc_info.value.status_code == 502


class TestFarmPodManagerStatus:
    """Tests for status method (GET /queue/management/tasks/info/{task_id})."""

    @respx.mock
    async def test_status_calls_farm_info_api_with_resolved_task_id(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status calls Farm Tasks info endpoint with resolved task_id."""
        _mock_task_list(sample_session)
        route = respx.get(
            f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}"
        ).respond(
            status_code=200,
            json={"task_id": FARM_TASK_ID, "status": "running"},
        )

        await pod_manager.status(sample_session)

        assert route.called

    @respx.mock
    async def test_status_returns_running(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns RUNNING for running task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "running"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.RUNNING

    @respx.mock
    async def test_status_returns_starting_for_submitted(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STARTING for submitted task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "submitted"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STARTING

    @respx.mock
    async def test_status_returns_starting_for_waiting(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STARTING for waiting task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "waiting"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STARTING

    @respx.mock
    async def test_status_returns_starting_for_starting(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STARTING for starting task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "starting"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STARTING

    @respx.mock
    async def test_status_returns_stopped_for_finished(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STOPPED for finished task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "finished"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPED

    @respx.mock
    async def test_status_returns_stopped_for_cancelled(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STOPPED for cancelled task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "cancelled"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPED

    @respx.mock
    async def test_status_returns_failed_for_errored(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns FAILED for errored task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "errored"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.FAILED

    @respx.mock
    async def test_status_returns_stopping_for_cancelling(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STOPPING for cancelling task."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "cancelling"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPING

    @respx.mock
    async def test_status_returns_stopped_when_task_not_resolved(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STOPPED when no matching Farm task found."""
        _mock_task_list_empty()

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPED

    @respx.mock
    async def test_status_returns_stopped_when_not_found(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns STOPPED when task not found (404)."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            status_code=404,
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPED

    @respx.mock
    async def test_status_returns_failed_for_unknown_status(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status returns FAILED for unknown Farm status."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            json={"task_id": FARM_TASK_ID, "status": "some-unknown-status"},
        )

        result = await pod_manager.status(sample_session)

        assert result == SessionStatus.FAILED

    @respx.mock
    async def test_status_raises_on_api_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that status raises FarmApiError on API failure."""
        _mock_task_list(sample_session)
        respx.get(f"https://farm.example.com/queue/management/tasks/info/{FARM_TASK_ID}").respond(
            status_code=500,
            text="Internal Server Error",
        )

        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.status(sample_session)

        assert exc_info.value.status_code == 500


class TestFarmPodManagerGetEndpoint:
    """Tests for get_endpoint method (GET /queue/management/tasks/tasks/{task_id}/endpoint)."""

    @respx.mock
    async def test_get_endpoint_calls_farm_endpoint_api_with_resolved_task_id(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint calls Farm Tasks endpoint API with resolved task_id."""
        _mock_task_list(sample_session)
        route = respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=200,
            json={
                "task_id": FARM_TASK_ID,
                "endpoint": "https://session-123.volundr.example.com",
                "status": "running",
            },
        )

        await pod_manager.get_endpoint(sample_session)

        assert route.called

    @respx.mock
    async def test_get_endpoint_returns_farm_endpoint_with_paths(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint returns Farm endpoint with paths appended."""
        _mock_task_list(sample_session)
        respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=200,
            json={
                "task_id": FARM_TASK_ID,
                "endpoint": "https://session-123.volundr.example.com",
                "status": "running",
            },
        )

        chat_endpoint, code_endpoint = await pod_manager.get_endpoint(sample_session)

        assert chat_endpoint == "https://session-123.volundr.example.com/session"
        assert code_endpoint == "https://session-123.volundr.example.com/"

    @respx.mock
    async def test_get_endpoint_returns_none_when_task_not_resolved(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint returns None tuple when no matching Farm task found."""
        _mock_task_list_empty()

        chat_endpoint, code_endpoint = await pod_manager.get_endpoint(sample_session)

        assert chat_endpoint is None
        assert code_endpoint is None

    @respx.mock
    async def test_get_endpoint_returns_none_on_202(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint returns None tuple when task not ready (202)."""
        _mock_task_list(sample_session)
        respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=202,
            json={"task_id": FARM_TASK_ID, "status": "starting"},
        )

        chat_endpoint, code_endpoint = await pod_manager.get_endpoint(sample_session)

        assert chat_endpoint is None
        assert code_endpoint is None

    @respx.mock
    async def test_get_endpoint_returns_none_on_404(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint returns None tuple when task not found."""
        _mock_task_list(sample_session)
        respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=404,
        )

        chat_endpoint, code_endpoint = await pod_manager.get_endpoint(sample_session)

        assert chat_endpoint is None
        assert code_endpoint is None

    @respx.mock
    async def test_get_endpoint_falls_back_to_client_side_when_null(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint falls back to client-side generation when endpoint is null."""
        _mock_task_list(sample_session)
        session_name = sample_session.name
        respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=200,
            json={
                "task_id": FARM_TASK_ID,
                "endpoint": None,  # Farm returns null endpoint
                "status": "running",
            },
        )

        chat_endpoint, code_endpoint = await pod_manager.get_endpoint(sample_session)

        # Should fall back to client-side generation using session name
        assert chat_endpoint == f"wss://{session_name}.volundr.example.com/session"
        assert code_endpoint == f"https://{session_name}.volundr.example.com/"

    @respx.mock
    async def test_get_endpoint_raises_on_api_error(
        self, pod_manager: FarmPodManager, sample_session: Session
    ):
        """Test that get_endpoint raises FarmApiError on API failure."""
        _mock_task_list(sample_session)
        respx.get(
            f"https://farm.example.com/queue/management/tasks/tasks/{FARM_TASK_ID}/endpoint"
        ).respond(
            status_code=500,
            text="Internal Server Error",
        )

        with pytest.raises(FarmApiError) as exc_info:
            await pod_manager.get_endpoint(sample_session)

        assert exc_info.value.status_code == 500


class TestFarmStatusMapping:
    """Tests for _map_farm_status helper."""

    @pytest.mark.parametrize(
        "farm_status,expected",
        [
            # Starting states
            ("submitted", SessionStatus.STARTING),
            ("waiting", SessionStatus.STARTING),
            ("starting", SessionStatus.STARTING),
            ("pending", SessionStatus.STARTING),
            ("unscheduled", SessionStatus.STARTING),
            # Running state
            ("running", SessionStatus.RUNNING),
            # Stopped states
            ("finished", SessionStatus.STOPPED),
            ("cancelled", SessionStatus.STOPPED),
            ("archived", SessionStatus.STOPPED),
            ("paused", SessionStatus.STOPPED),
            # Failed states
            ("errored", SessionStatus.FAILED),
            ("unschedulable", SessionStatus.FAILED),
            # Stopping states
            ("cancelling", SessionStatus.STOPPING),
            ("pausing", SessionStatus.STOPPING),
            # Unknown defaults to FAILED
            ("unknown", SessionStatus.FAILED),
            ("some-random-status", SessionStatus.FAILED),
        ],
    )
    def test_maps_farm_status_to_session_status(
        self, pod_manager: FarmPodManager, farm_status: str, expected: SessionStatus
    ):
        """Test Farm status to SessionStatus mapping."""
        result = pod_manager._map_farm_status(farm_status)
        assert result == expected


class TestFarmPodManagerClient:
    """Tests for HTTP client management."""

    async def test_uses_provided_client(self):
        """Test that provided client is used."""
        mock_client = httpx.AsyncClient()
        manager = FarmPodManager(
            base_url="https://farm.example.com",
            token="test-token",
            base_domain="volundr.example.com",
            client=mock_client,
        )

        client = await manager._get_client()

        assert client is mock_client
        await mock_client.aclose()

    async def test_creates_client_with_auth_header(self):
        """Test that created client has auth header."""
        manager = FarmPodManager(
            base_url="https://farm.example.com",
            token="test-token",
            base_domain="volundr.example.com",
        )

        client = await manager._get_client()

        assert client.headers["Authorization"] == "Bearer test-token"
        await manager.close()

    async def test_creates_client_without_auth_when_no_token(self):
        """Test that client has no auth header when token is None."""
        manager = FarmPodManager(
            base_url="https://farm.example.com",
            token=None,
            base_domain="volundr.example.com",
        )

        client = await manager._get_client()

        assert "Authorization" not in client.headers
        await manager.close()

    async def test_close_closes_owned_client(self):
        """Test that close() closes client when we own it."""
        manager = FarmPodManager(
            base_url="https://farm.example.com",
            token="test-token",
            base_domain="volundr.example.com",
        )
        await manager._get_client()  # Create client

        await manager.close()

        assert manager._client is None

    async def test_close_does_not_close_provided_client(self):
        """Test that close() does not close client when provided externally."""
        mock_client = httpx.AsyncClient()
        manager = FarmPodManager(
            base_url="https://farm.example.com",
            token="test-token",
            base_domain="volundr.example.com",
            client=mock_client,
        )

        await manager.close()

        # Client should still be open (we don't own it)
        assert not mock_client.is_closed
        await mock_client.aclose()




class TestFarmPodManagerGatewayEndpoints:
    """Tests for path-based endpoint generation with gateway_domain."""

    def test_host_based_endpoints_without_gateway_domain(self):
        pm = FarmPodManager(
            base_url="https://farm.example.com",
            base_domain="volundr.example.com",
            chat_scheme="wss",
            code_scheme="https",
        )
        assert pm._chat_endpoint("my-session") == ("wss://my-session.volundr.example.com/session")
        assert pm._code_endpoint("my-session") == ("https://my-session.volundr.example.com/")

    def test_path_based_endpoints_with_gateway_domain(self):
        pm = FarmPodManager(
            base_url="https://farm.example.com",
            gateway_domain="gateway.example.com",
            base_domain="volundr.example.com",
        )
        sid = "abc-123"
        assert pm._chat_endpoint("my-session", sid) == (
            "wss://gateway.example.com/s/abc-123/session"
        )
        assert pm._code_endpoint("my-session", sid) == (
            "https://gateway.example.com/s/abc-123/"
        )

    @respx.mock
    async def test_start_returns_path_based_endpoints(self, sample_session: Session):
        pm = FarmPodManager(
            base_url="https://farm.example.com",
            gateway_domain="gateway.example.com",
            base_domain="volundr.example.com",
        )
        respx.post("https://farm.example.com/queue/management/tasks/submit").respond(
            status_code=200,
            json={"task_id": str(sample_session.id)},
        )
        spec = make_spec()
        result = await pm.start(sample_session, spec)
        session_id = str(sample_session.id)
        assert result.chat_endpoint == (f"wss://gateway.example.com/s/{session_id}/session")
        assert result.code_endpoint == (f"https://gateway.example.com/s/{session_id}/")


class TestFarmPodManagerSpecPassthrough:
    """Tests for spec values pass-through to task_args."""

    @respx.mock
    async def test_spec_values_passed_as_task_args(self, sample_session: Session):
        pm = FarmPodManager(
            base_url="https://farm.example.com",
            base_domain="volundr.example.com",
        )
        route = respx.post(
            "https://farm.example.com/queue/management/tasks/submit",
        ).respond(status_code=200, json={})

        spec = make_spec(
            gateway={"enabled": True, "name": "my-gw"},
            git={"repoUrl": "https://github.com/org/repo", "branch": "main"},
        )
        await pm.start(sample_session, spec)

        payload = json.loads(route.calls[0].request.content)
        assert payload["task_args"]["gateway"]["enabled"] is True
        assert payload["task_args"]["gateway"]["name"] == "my-gw"
        assert payload["task_args"]["git"]["repoUrl"] == "https://github.com/org/repo"

    @respx.mock
    async def test_empty_spec_sends_empty_task_args(self, sample_session: Session):
        pm = FarmPodManager(
            base_url="https://farm.example.com",
            base_domain="volundr.example.com",
        )
        route = respx.post(
            "https://farm.example.com/queue/management/tasks/submit",
        ).respond(status_code=200, json={})

        spec = make_spec()
        await pm.start(sample_session, spec)

        payload = json.loads(route.calls[0].request.content)
        assert "gateway" not in payload["task_args"]
