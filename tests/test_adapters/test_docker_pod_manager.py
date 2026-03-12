"""Tests for Docker Compose pod manager adapter."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from python_on_whales import DockerException

from tests.conftest import make_spec
from volundr.adapters.outbound.docker_pod_manager import DockerPodManager
from volundr.domain.models import GitSource, Session, SessionStatus


@pytest.fixture
def sample_session() -> Session:
    """Create a sample session for testing."""
    return Session(
        id=uuid4(),
        name="test-session",
        model="claude-sonnet-4-20250514",
        source=GitSource(repo="https://github.com/org/repo", branch="main"),
    )


@pytest.fixture
def sample_spec():
    """Create a sample session spec."""
    return make_spec(MODEL="claude-sonnet-4-20250514", REPO_URL="https://github.com/org/repo")


@pytest.fixture
def tmp_compose_dir(tmp_path: Path) -> Path:
    """Provide a temporary compose directory."""
    return tmp_path / "sessions"


@pytest.fixture
def pod_manager(tmp_compose_dir: Path) -> DockerPodManager:
    """Create a DockerPodManager with test defaults."""
    return DockerPodManager(
        network="test-net",
        skuld_image="test/skuld:latest",
        code_server_image="test/code-server:latest",
        ttyd_image="test/ttyd:latest",
        compose_dir=str(tmp_compose_dir),
        db_host="localhost",
        db_port=5432,
        db_user="test",
        db_password="testpw",
        db_name="testdb",
        poll_interval=0.01,
    )


@pytest.fixture
def gateway_pod_manager(tmp_compose_dir: Path) -> DockerPodManager:
    """Create a DockerPodManager with gateway_domain set."""
    return DockerPodManager(
        compose_dir=str(tmp_compose_dir),
        gateway_domain="volundr.example.com",
        poll_interval=0.01,
    )


def _mock_container(status: str = "running") -> MagicMock:
    """Create a mock python-on-whales Container with the given state."""
    container = MagicMock()
    container.state = SimpleNamespace(status=status)
    return container


def _mock_docker_client(
    *,
    up_side_effect=None,
    down_side_effect=None,
    ps_return=None,
    ps_side_effect=None,
) -> MagicMock:
    """Create a mock DockerClient with compose methods."""
    client = MagicMock()
    client.compose = MagicMock()

    if up_side_effect:
        client.compose.up = MagicMock(side_effect=up_side_effect)
    else:
        client.compose.up = MagicMock()

    if down_side_effect:
        client.compose.down = MagicMock(side_effect=down_side_effect)
    else:
        client.compose.down = MagicMock()

    if ps_side_effect:
        client.compose.ps = MagicMock(side_effect=ps_side_effect)
    elif ps_return is not None:
        client.compose.ps = MagicMock(return_value=ps_return)
    else:
        client.compose.ps = MagicMock(return_value=[])

    return client


@pytest.mark.asyncio
async def test_start_generates_compose_and_runs(
    pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
    tmp_compose_dir: Path,
):
    """Verify compose file is written and docker compose up is called."""
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        result = await pod_manager.start(sample_session, sample_spec)

    # Compose file should exist
    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    assert compose_path.exists()

    # Verify compose content
    import yaml

    compose = yaml.safe_load(compose_path.read_text())
    assert "skuld" in compose["services"]
    assert "code-server" in compose["services"]
    assert "ttyd" in compose["services"]
    assert compose["services"]["skuld"]["image"] == "test/skuld:latest"
    assert compose["services"]["skuld"]["environment"]["SESSION_ID"] == str(sample_session.id)
    assert compose["services"]["skuld"]["environment"]["DATABASE__HOST"] == "localhost"

    # Verify docker compose up was called with detach=True
    client.compose.up.assert_called_once_with(detach=True)

    # Verify result
    assert result.pod_name == f"volundr-session-{sample_session.id}"
    assert result.chat_endpoint
    assert result.code_endpoint


@pytest.mark.asyncio
async def test_stop_calls_compose_down(
    pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
    tmp_compose_dir: Path,
):
    """Verify docker compose down is called and directory is cleaned up."""
    # First start to create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, sample_spec)

    compose_dir = tmp_compose_dir / str(sample_session.id)
    assert compose_dir.exists()

    # Now stop
    stop_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=stop_client):
        result = await pod_manager.stop(sample_session)

    assert result is True

    # Verify docker compose down was called
    stop_client.compose.down.assert_called_once()

    # Directory should be cleaned up
    assert not compose_dir.exists()


@pytest.mark.asyncio
async def test_status_maps_container_states(
    pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
):
    """Mock docker compose ps output and verify SessionStatus mapping."""
    # Create compose file first
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    containers = [
        _mock_container("running"),
        _mock_container("running"),
        _mock_container("running"),
    ]
    ps_client = _mock_docker_client(ps_return=containers)

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.status(sample_session)

    assert status == SessionStatus.RUNNING


@pytest.mark.asyncio
async def test_status_maps_dead_to_failed(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Verify that a dead container maps to FAILED."""
    # Create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    containers = [
        _mock_container("running"),
        _mock_container("dead"),
    ]
    ps_client = _mock_docker_client(ps_return=containers)

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.status(sample_session)

    assert status == SessionStatus.FAILED


@pytest.mark.asyncio
async def test_status_returns_stopped_when_no_containers(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """When docker compose ps returns empty, status should be STOPPED."""
    # Create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    ps_client = _mock_docker_client(ps_return=[])

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.status(sample_session)

    assert status == SessionStatus.STOPPED


@pytest.mark.asyncio
async def test_status_returns_stopped_when_no_compose_file(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """When no compose file exists, status should be STOPPED."""
    status = await pod_manager.status(sample_session)
    assert status == SessionStatus.STOPPED


@pytest.mark.asyncio
async def test_wait_for_ready_polls_until_running(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Mock status returning STARTING then RUNNING."""
    # Create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    starting_containers = [_mock_container("created")]
    running_containers = [
        _mock_container("running"),
        _mock_container("running"),
        _mock_container("running"),
    ]

    call_count = 0

    def mock_ps():
        nonlocal call_count
        call_count += 1
        if call_count <= 1:
            return starting_containers
        return running_containers

    ps_client = _mock_docker_client(ps_side_effect=mock_ps)

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.wait_for_ready(sample_session, timeout=1.0)

    assert status == SessionStatus.RUNNING


@pytest.mark.asyncio
async def test_wait_for_ready_returns_failed_on_timeout(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Mock status always returning STARTING, should timeout to FAILED."""
    # Create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    starting_containers = [_mock_container("created")]
    ps_client = _mock_docker_client(ps_return=starting_containers)

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.wait_for_ready(sample_session, timeout=0.05)

    assert status == SessionStatus.FAILED


@pytest.mark.asyncio
async def test_start_with_gateway_domain(
    gateway_pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
):
    """Verify endpoint URLs use gateway_domain when set."""
    client = _mock_docker_client()

    with patch.object(gateway_pod_manager, "_docker_client", return_value=client):
        result = await gateway_pod_manager.start(sample_session, sample_spec)

    assert result.chat_endpoint == (f"wss://volundr.example.com/s/{sample_session.id}/session")
    assert result.code_endpoint == (f"https://volundr.example.com/s/{sample_session.id}/")


@pytest.mark.asyncio
async def test_start_without_gateway_domain(
    pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
):
    """Verify endpoint URLs use container network when no gateway_domain."""
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        result = await pod_manager.start(sample_session, sample_spec)

    project = f"volundr-session-{sample_session.id}"
    assert result.chat_endpoint == f"http://{project}-skuld-1:8080/session"
    assert result.code_endpoint == f"http://{project}-code-server-1:8080/"


@pytest.mark.asyncio
async def test_compose_template_includes_spec_values(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify non-structured spec.values are passed as environment variables."""
    spec = make_spec(
        CUSTOM_VAR="custom_value",
        ANOTHER_VAR="another_value",
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert skuld_env["CUSTOM_VAR"] == "custom_value"
    assert skuld_env["ANOTHER_VAR"] == "another_value"
    # Standard env vars should also be present
    assert skuld_env["SESSION_ID"] == str(sample_session.id)
    assert skuld_env["SESSION_NAME"] == sample_session.name


@pytest.mark.asyncio
async def test_start_raises_on_compose_failure(
    pod_manager: DockerPodManager,
    sample_session: Session,
    sample_spec,
):
    """Verify RuntimeError is raised when docker compose up fails."""
    client = _mock_docker_client(
        up_side_effect=DockerException(["docker", "compose", "up"], 1),
    )

    with patch.object(pod_manager, "_docker_client", return_value=client):
        with pytest.raises(RuntimeError, match="docker compose up failed"):
            await pod_manager.start(sample_session, sample_spec)


@pytest.mark.asyncio
async def test_stop_returns_true_when_no_compose_file(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Stopping a session with no compose file should return True."""
    result = await pod_manager.stop(sample_session)
    assert result is True


@pytest.mark.asyncio
async def test_stop_returns_false_on_failure(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Verify stop returns False when docker compose down fails."""
    # Create compose file
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    stop_client = _mock_docker_client(
        down_side_effect=DockerException(["docker", "compose", "down"], 1),
    )

    with patch.object(pod_manager, "_docker_client", return_value=stop_client):
        result = await pod_manager.stop(sample_session)

    assert result is False


@pytest.mark.asyncio
async def test_status_handles_docker_exception(
    pod_manager: DockerPodManager,
    sample_session: Session,
):
    """Verify DockerException during ps returns STOPPED."""
    start_client = _mock_docker_client()
    with patch.object(pod_manager, "_docker_client", return_value=start_client):
        await pod_manager.start(sample_session, make_spec())

    ps_client = _mock_docker_client(
        ps_side_effect=DockerException(["docker", "compose", "ps"], 1),
    )

    with patch.object(pod_manager, "_docker_client", return_value=ps_client):
        status = await pod_manager.status(sample_session)

    assert status == SessionStatus.STOPPED


@pytest.mark.asyncio
async def test_extra_kwargs_ignored():
    """Verify extra kwargs are accepted and ignored (dynamic adapter pattern)."""
    manager = DockerPodManager(
        network="test",
        some_unknown_kwarg="ignored",
        another_extra=42,
    )
    assert manager._network == "test"


def test_aggregate_status_running():
    """Verify all-running containers map to RUNNING."""
    containers = [_mock_container("running"), _mock_container("running")]
    assert DockerPodManager._aggregate_status(containers) == SessionStatus.RUNNING


def test_aggregate_status_dead():
    """Verify a dead container maps to FAILED."""
    containers = [_mock_container("running"), _mock_container("dead")]
    assert DockerPodManager._aggregate_status(containers) == SessionStatus.FAILED


def test_aggregate_status_exited():
    """Verify an exited container maps to STOPPED."""
    containers = [_mock_container("running"), _mock_container("exited")]
    assert DockerPodManager._aggregate_status(containers) == SessionStatus.STOPPED


def test_aggregate_status_created():
    """Verify a created container maps to STARTING."""
    containers = [_mock_container("created")]
    assert DockerPodManager._aggregate_status(containers) == SessionStatus.STARTING


def _mock_credential_store(secrets: dict[str, dict[str, str]]) -> MagicMock:
    """Create a mock CredentialStorePort that returns given secrets.

    Args:
        secrets: Mapping of secret_name -> {key: value} pairs.
    """
    store = MagicMock()

    async def _get_value(owner_type, owner_id, name):
        return secrets.get(name)

    store.get_value = AsyncMock(side_effect=_get_value)
    return store


@pytest.mark.asyncio
async def test_compose_handles_env_secrets(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify envSecrets are resolved via the credential store."""
    sample_session.owner_id = "user-123"
    store = _mock_credential_store(
        {
            "my-api-key": {"token": "secret-token-value"},
        }
    )
    pod_manager.set_credential_store(store)

    spec = make_spec(
        envSecrets=[
            {
                "secretName": "my-api-key",
                "secretKey": "token",
                "envVar": "API_TOKEN",
            },
        ],
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert skuld_env["API_TOKEN"] == "secret-token-value"
    store.get_value.assert_called_once_with("user", "user-123", "my-api-key")


@pytest.mark.asyncio
async def test_env_secrets_without_credential_store(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify no crash when envSecrets present but credential_store is None."""
    spec = make_spec(
        envSecrets=[
            {
                "secretName": "my-api-key",
                "secretKey": "token",
                "envVar": "API_TOKEN",
            },
        ],
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        result = await pod_manager.start(sample_session, spec)

    assert result.pod_name  # Should succeed without errors

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    # Secret should NOT be present since no credential store
    assert "API_TOKEN" not in skuld_env


@pytest.mark.asyncio
async def test_compose_handles_persistence_bind_mounts(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify persistence config creates bind mount volumes."""
    spec = make_spec(
        persistence={
            "existingClaim": "/data/sessions",
            "mountPath": "/volundr/sessions",
        },
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_volumes = compose["services"]["skuld"]["volumes"]
    assert "/data/sessions:/volundr/sessions" in skuld_volumes
    # Should not have the default workspace volume
    assert "workspace:/workspace" not in skuld_volumes
    # Should not have a named volumes section
    assert "volumes" not in compose


@pytest.mark.asyncio
async def test_compose_handles_home_volume_bind_mount(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify homeVolume config creates bind mount volume."""
    spec = make_spec(
        homeVolume={
            "existingClaim": "/data/home/user1",
            "mountPath": "/volundr/home",
        },
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_volumes = compose["services"]["skuld"]["volumes"]
    assert "/data/home/user1:/volundr/home" in skuld_volumes


@pytest.mark.asyncio
async def test_compose_handles_git_config(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify git config is mapped to GIT_CLONE_URL and GIT_BRANCH env vars."""
    spec = make_spec(
        git={
            "cloneUrl": "https://github.com/org/repo.git",
            "branch": "feature/test",
        },
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert skuld_env["GIT_CLONE_URL"] == "https://github.com/org/repo.git"
    assert skuld_env["GIT_BRANCH"] == "feature/test"


@pytest.mark.asyncio
async def test_compose_handles_mcp_servers(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify mcpServers are serialized as MCP_SERVERS JSON env var."""
    mcp_servers = [
        {"name": "linear", "command": "mcp-linear", "args": ["--token", "xxx"]},
    ]
    spec = make_spec(mcpServers=mcp_servers)
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert json.loads(skuld_env["MCP_SERVERS"]) == mcp_servers


@pytest.mark.asyncio
async def test_compose_ignores_k8s_specific_values(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify K8s-specific keys are not dumped as flat env vars."""
    spec = make_spec(
        ingress={"host": "example.com"},
        resources={"limits": {"cpu": "1", "memory": "2Gi"}},
        podSpec={"nodeSelector": {"gpu": "true"}},
        pod_spec={"tolerations": []},
        REAL_VAR="should-appear",
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    # Structured keys must not appear as flat env vars
    assert "ingress" not in skuld_env
    assert "resources" not in skuld_env
    assert "podSpec" not in skuld_env
    assert "pod_spec" not in skuld_env
    # Regular values should still appear
    assert skuld_env["REAL_VAR"] == "should-appear"


@pytest.mark.asyncio
async def test_compose_handles_extra_env(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify env dict is passed through as environment variables."""
    spec = make_spec(
        env={
            "CUSTOM_FLAG": "true",
            "LOG_LEVEL": "debug",
            "PORT": 8080,
        },
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert skuld_env["CUSTOM_FLAG"] == "true"
    assert skuld_env["LOG_LEVEL"] == "debug"
    assert skuld_env["PORT"] == "8080"


@pytest.mark.asyncio
async def test_compose_handles_session_model(
    pod_manager: DockerPodManager,
    sample_session: Session,
    tmp_compose_dir: Path,
):
    """Verify session.model is mapped to SESSION_MODEL env var."""
    spec = make_spec(
        session={"model": "claude-opus-4-20250514"},
    )
    client = _mock_docker_client()

    with patch.object(pod_manager, "_docker_client", return_value=client):
        await pod_manager.start(sample_session, spec)

    import yaml

    compose_path = tmp_compose_dir / str(sample_session.id) / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())

    skuld_env = compose["services"]["skuld"]["environment"]
    assert skuld_env["SESSION_MODEL"] == "claude-opus-4-20250514"
