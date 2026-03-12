"""Tests for DirectK8sPodManager adapter.

Tests against the kubernetes-asyncio client with mocked API calls.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from tests.conftest import make_spec
from volundr.adapters.outbound.direct_k8s_pod_manager import (
    DEFAULT_POLL_INTERVAL,
    DEFAULT_READINESS_TIMEOUT,
    MANAGED_BY_LABEL,
    MANAGED_BY_VALUE,
    SESSION_LABEL,
    SESSION_SERVICE_PORT,
    DirectK8sPodManager,
)
from volundr.domain.models import GitSource, Session, SessionStatus


@pytest.fixture
def sample_session() -> Session:
    """Create a sample session for testing."""
    return Session(
        id=uuid4(),
        name="Test K3s Session",
        model="claude-sonnet-4-20250514",
        source=GitSource(repo="https://github.com/org/repo", branch="main"),
    )


@pytest.fixture
def pod_manager() -> DirectK8sPodManager:
    """Create a DirectK8sPodManager for testing."""
    return DirectK8sPodManager(
        namespace="test-ns",
        kubeconfig="/test/kubeconfig",
        base_path="/s",
        ingress_class="traefik",
        skuld_image="ghcr.io/niuulabs/skuld:test",
        code_server_image="codercom/code-server:test",
        nginx_image="nginx:test",
        devrunner_image="ghcr.io/niuulabs/devrunner:test",
        db_host="host.k3d.internal",
        db_port=5433,
        db_user="volundr",
        db_password="testpass",
        db_name="volundr",
    )


class TestConstructor:
    """Test DirectK8sPodManager constructor."""

    def test_default_values(self) -> None:
        pm = DirectK8sPodManager()
        assert pm._namespace == "volundr"
        assert pm._kubeconfig == ""
        assert pm._base_path == "/s"
        assert pm._ingress_class == "traefik"
        assert pm._poll_interval == DEFAULT_POLL_INTERVAL
        assert pm._readiness_timeout == DEFAULT_READINESS_TIMEOUT

    def test_custom_values(self, pod_manager: DirectK8sPodManager) -> None:
        assert pod_manager._namespace == "test-ns"
        assert pod_manager._kubeconfig == "/test/kubeconfig"
        assert pod_manager._base_path == "/s"
        assert pod_manager._skuld_image == "ghcr.io/niuulabs/skuld:test"
        assert pod_manager._db_host == "host.k3d.internal"
        assert pod_manager._db_port == 5433
        assert pod_manager._db_password == "testpass"

    def test_extra_kwargs_ignored(self) -> None:
        pm = DirectK8sPodManager(
            namespace="test",
            unknown_key="should-not-fail",
            another_key=42,
        )
        assert pm._namespace == "test"


class TestResourceNames:
    """Test resource name generation."""

    def test_release_name(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        name = pod_manager._release_name(sample_session)
        assert name == f"skuld-{sample_session.id}"

    def test_session_path(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        path = pod_manager._session_path(sample_session)
        assert path == f"/s/{sample_session.id}"

    def test_chat_endpoint(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        endpoint = pod_manager._chat_endpoint(sample_session)
        assert endpoint == f"ws://k3d-volundr-serverlb/s/{sample_session.id}/session"

    def test_code_endpoint(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        endpoint = pod_manager._code_endpoint(sample_session)
        assert endpoint == f"http://k3d-volundr-serverlb/s/{sample_session.id}/"

    def test_middleware_name(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        name = pod_manager._middleware_name(sample_session)
        assert name == f"test-ns-strip-{sample_session.id}"


class TestLabels:
    """Test label generation."""

    def test_build_labels(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        labels = pod_manager._build_labels(sample_session)
        assert labels[MANAGED_BY_LABEL] == MANAGED_BY_VALUE
        assert labels[SESSION_LABEL] == str(sample_session.id)
        assert labels["app.kubernetes.io/name"] == "skuld"
        assert labels["app.kubernetes.io/instance"] == f"skuld-{sample_session.id}"


class TestEnvironment:
    """Test environment variable building."""

    def test_build_env_basic(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        spec = make_spec()
        env = pod_manager._build_env(sample_session, spec)

        env_dict = {e["name"]: e["value"] for e in env if "value" in e}
        assert env_dict["SESSION_ID"] == str(sample_session.id)
        assert env_dict["SESSION_NAME"] == sample_session.name
        assert env_dict["DATABASE__HOST"] == "host.k3d.internal"
        assert env_dict["DATABASE__PORT"] == "5433"
        assert env_dict["DATABASE__USER"] == "volundr"
        assert env_dict["DATABASE__PASSWORD"] == "testpass"
        assert env_dict["DATABASE__NAME"] == "volundr"

    def test_build_env_with_git(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        spec = make_spec(
            git={"cloneUrl": "https://github.com/org/repo", "branch": "develop"},
        )
        env = pod_manager._build_env(sample_session, spec)

        env_dict = {e["name"]: e["value"] for e in env if "value" in e}
        assert env_dict["GIT_CLONE_URL"] == "https://github.com/org/repo"
        assert env_dict["GIT_BRANCH"] == "develop"

    def test_build_env_with_session_model(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        spec = make_spec(session={"model": "claude-opus-4-20250514"})
        env = pod_manager._build_env(sample_session, spec)

        env_dict = {e["name"]: e["value"] for e in env if "value" in e}
        assert env_dict["SESSION_MODEL"] == "claude-opus-4-20250514"

    def test_build_env_with_extra_env(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        spec = make_spec(env={"CUSTOM_VAR": "custom_value", "PORT": 3000})
        env = pod_manager._build_env(sample_session, spec)

        env_dict = {e["name"]: e["value"] for e in env if "value" in e}
        assert env_dict["CUSTOM_VAR"] == "custom_value"
        assert env_dict["PORT"] == "3000"


class TestManifests:
    """Test manifest generation."""

    def test_build_deployment_manifest(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        spec = make_spec()
        manifest = pod_manager._build_deployment_manifest(sample_session, spec)

        assert manifest["apiVersion"] == "apps/v1"
        assert manifest["kind"] == "Deployment"
        assert manifest["metadata"]["name"] == f"skuld-{sample_session.id}"
        assert manifest["metadata"]["namespace"] == "test-ns"
        assert manifest["spec"]["replicas"] == 1

        containers = manifest["spec"]["template"]["spec"]["containers"]
        container_names = [c["name"] for c in containers]
        assert "nginx" in container_names
        assert "skuld" in container_names
        assert "code-server" in container_names
        assert "devrunner" in container_names

        # Check skuld env vars.
        skuld = next(c for c in containers if c["name"] == "skuld")
        env_dict = {e["name"]: e["value"] for e in skuld["env"] if "value" in e}
        assert env_dict["SESSION_ID"] == str(sample_session.id)
        assert env_dict["DATABASE__HOST"] == "host.k3d.internal"

    def test_build_service_manifest(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        manifest = pod_manager._build_service_manifest(sample_session)

        assert manifest["apiVersion"] == "v1"
        assert manifest["kind"] == "Service"
        assert manifest["metadata"]["name"] == f"skuld-{sample_session.id}"
        assert manifest["spec"]["type"] == "ClusterIP"
        assert manifest["spec"]["ports"][0]["port"] == SESSION_SERVICE_PORT

    def test_build_ingress_manifest(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        manifest = pod_manager._build_ingress_manifest(sample_session)

        assert manifest["apiVersion"] == "networking.k8s.io/v1"
        assert manifest["kind"] == "Ingress"
        assert manifest["spec"]["ingressClassName"] == "traefik"

        # Verify path-based routing with no host.
        rule = manifest["spec"]["rules"][0]
        assert "host" not in rule
        path = rule["http"]["paths"][0]
        assert path["path"] == f"/s/{sample_session.id}"
        assert path["pathType"] == "Prefix"
        assert path["backend"]["service"]["name"] == f"skuld-{sample_session.id}"
        assert path["backend"]["service"]["port"]["number"] == SESSION_SERVICE_PORT

        # Verify Traefik strip-prefix annotation.
        annotations = manifest["metadata"]["annotations"]
        expected_mw = f"test-ns-skuld-{sample_session.id}-strip@kubernetescrd"
        assert annotations["traefik.ingress.kubernetes.io/router.middlewares"] == expected_mw


class TestStripPrefixMiddleware:
    """Test Traefik middleware generation."""

    def test_build_strip_prefix_middleware(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        mw = pod_manager._build_strip_prefix_middleware(sample_session)

        assert mw["apiVersion"] == "traefik.io/v1alpha1"
        assert mw["kind"] == "Middleware"
        assert mw["metadata"]["name"] == f"skuld-{sample_session.id}-strip"
        assert mw["metadata"]["namespace"] == "test-ns"
        assert mw["spec"]["stripPrefix"]["prefixes"] == [
            f"/s/{sample_session.id}"
        ]


class TestDeploymentStatus:
    """Test deployment status mapping."""

    def test_running(self) -> None:
        deployment = MagicMock()
        deployment.spec.replicas = 1
        deployment.status.ready_replicas = 1
        deployment.status.conditions = []

        status = DirectK8sPodManager._map_deployment_status(deployment)
        assert status == SessionStatus.RUNNING

    def test_starting_no_ready(self) -> None:
        deployment = MagicMock()
        deployment.spec.replicas = 1
        deployment.status.ready_replicas = 0
        deployment.status.conditions = []

        status = DirectK8sPodManager._map_deployment_status(deployment)
        assert status == SessionStatus.STARTING

    def test_starting_none_ready(self) -> None:
        deployment = MagicMock()
        deployment.spec.replicas = 1
        deployment.status.ready_replicas = None
        deployment.status.conditions = []

        status = DirectK8sPodManager._map_deployment_status(deployment)
        assert status == SessionStatus.STARTING

    def test_no_status(self) -> None:
        deployment = MagicMock()
        deployment.status = None

        status = DirectK8sPodManager._map_deployment_status(deployment)
        assert status == SessionStatus.STARTING

    def test_failed_progressing_false(self) -> None:
        condition = MagicMock()
        condition.type = "Progressing"
        condition.status = "False"

        deployment = MagicMock()
        deployment.spec.replicas = 1
        deployment.status.ready_replicas = 0
        deployment.status.conditions = [condition]

        status = DirectK8sPodManager._map_deployment_status(deployment)
        assert status == SessionStatus.FAILED


class TestStart:
    """Test the start method with mocked K8s client."""

    @pytest.mark.asyncio
    async def test_start_creates_resources(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        pod_manager._api_client = MagicMock()
        spec = make_spec()

        mock_cr = AsyncMock()
        mock_apply = AsyncMock()
        with patch.object(
            pod_manager, "_apply_custom_resource", mock_cr,
        ), patch.object(
            pod_manager, "_apply_resource", mock_apply,
        ):
            result = await pod_manager.start(sample_session, spec)

        mock_cr.assert_called_once()

        assert mock_apply.call_count == 4
        call_classes = [
            c.kwargs["api_class"] for c in mock_apply.call_args_list
        ]
        assert "AppsV1Api" in call_classes
        assert "NetworkingV1Api" in call_classes
        # CoreV1Api appears twice: ConfigMap + Service
        assert call_classes.count("CoreV1Api") == 2

        assert result.chat_endpoint == f"ws://k3d-volundr-serverlb/s/{sample_session.id}/session"
        assert result.code_endpoint == f"http://k3d-volundr-serverlb/s/{sample_session.id}/"
        assert result.pod_name == f"skuld-{sample_session.id}"


class TestStop:
    """Test the stop method with mocked K8s client."""

    @pytest.mark.asyncio
    async def test_stop_deletes_resources(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        pod_manager._api_client = MagicMock()

        mock_delete = AsyncMock(return_value=True)
        mock_delete_cr = AsyncMock()
        with patch.object(
            pod_manager, "_delete_resource", mock_delete,
        ), patch.object(
            pod_manager, "_delete_custom_resource", mock_delete_cr,
        ):
            result = await pod_manager.stop(sample_session)

        assert result is True
        assert mock_delete.call_count == 4
        call_classes = [
            c.args[0] for c in mock_delete.call_args_list
        ]
        assert "AppsV1Api" in call_classes
        assert "NetworkingV1Api" in call_classes
        # CoreV1Api appears twice: Service + ConfigMap
        assert call_classes.count("CoreV1Api") == 2
        mock_delete_cr.assert_called_once()


class TestStatus:
    """Test the status method with mocked K8s client."""

    @pytest.mark.asyncio
    async def test_status_running(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        deployment = MagicMock()
        deployment.spec.replicas = 1
        deployment.status.ready_replicas = 1
        deployment.status.conditions = []

        pod_manager._api_client = MagicMock()

        with patch.object(
            pod_manager, "_read_deployment",
            new_callable=AsyncMock,
            return_value=deployment,
        ):
            status = await pod_manager.status(sample_session)

        assert status == SessionStatus.RUNNING

    @pytest.mark.asyncio
    async def test_status_not_found(
        self,
        pod_manager: DirectK8sPodManager,
        sample_session: Session,
    ) -> None:
        pod_manager._api_client = MagicMock()

        with patch.object(
            pod_manager, "_read_deployment",
            new_callable=AsyncMock,
            return_value=None,
        ):
            status = await pod_manager.status(sample_session)

        assert status == SessionStatus.STOPPED


class TestCredentialStore:
    """Test credential store injection."""

    def test_set_credential_store(
        self,
        pod_manager: DirectK8sPodManager,
    ) -> None:
        assert pod_manager._credential_store is None

        mock_store = MagicMock()
        pod_manager.set_credential_store(mock_store)
        assert pod_manager._credential_store is mock_store


class TestClose:
    """Test client cleanup."""

    @pytest.mark.asyncio
    async def test_close_clears_clients(
        self,
        pod_manager: DirectK8sPodManager,
    ) -> None:
        mock_client = AsyncMock()
        pod_manager._api_client = mock_client

        await pod_manager.close()

        assert pod_manager._api_client is None
        mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_noop_when_not_initialized(
        self,
        pod_manager: DirectK8sPodManager,
    ) -> None:
        # Should not raise.
        await pod_manager.close()
        assert pod_manager._api_client is None
