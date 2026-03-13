"""Tests for Flux HelmRelease pod manager adapter."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from tests.conftest import make_spec
from volundr.adapters.outbound.flux import (
    HELMRELEASE_GROUP,
    HELMRELEASE_PLURAL,
    HELMRELEASE_VERSION,
    FluxPodManager,
)
from volundr.domain.models import (
    GitSource,
    Session,
    SessionStatus,
)


@pytest.fixture
def sample_session() -> Session:
    return Session(
        id=uuid4(),
        name="Test Session",
        model="claude-sonnet-4-20250514",
        source=GitSource(repo="https://github.com/org/repo", branch="main"),
    )


@pytest.fixture
def pod_manager() -> FluxPodManager:
    return FluxPodManager(
        namespace="test-ns",
        chart_name="skuld",
        chart_version="0.38.0",
        source_ref_kind="HelmRepository",
        source_ref_name="skuld-repo",
        timeout="5m",
        interval="5m",
        base_domain="volundr.example.com",
        chat_scheme="wss",
        code_scheme="https",
        session_defaults={
            "image": {"repository": "ghcr.io/niuulabs/skuld", "tag": "latest"},
            "resources": {"requests": {"memory": "256Mi", "cpu": "100m"}},
        },
    )


@pytest.fixture
def mock_api():
    api = AsyncMock()
    return api


class TestFluxPodManagerStart:
    async def test_start_creates_helmrelease(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        spec = make_spec(
            session={"id": str(sample_session.id), "name": sample_session.name},
        )
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            await pod_manager.start(sample_session, spec)

        mock_api.create_namespaced_custom_object.assert_called_once()
        call_kwargs = mock_api.create_namespaced_custom_object.call_args[1]
        assert call_kwargs["group"] == HELMRELEASE_GROUP
        assert call_kwargs["version"] == HELMRELEASE_VERSION
        assert call_kwargs["namespace"] == "test-ns"
        assert call_kwargs["plural"] == HELMRELEASE_PLURAL

        body = call_kwargs["body"]
        assert body["metadata"]["name"] == f"skuld-{sample_session.id}"
        assert body["spec"]["chart"]["spec"]["chart"] == "skuld"
        assert body["spec"]["chart"]["spec"]["version"] == "0.38.0"
        assert body["spec"]["values"]["session"]["id"] == str(sample_session.id)
        assert body["spec"]["values"]["session"]["name"] == sample_session.name

    async def test_start_returns_endpoints(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        spec = make_spec()
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.start(sample_session, spec)

        assert result.chat_endpoint == f"wss://{sample_session.name}.volundr.example.com/session"
        assert result.code_endpoint == f"https://{sample_session.name}.volundr.example.com/"
        assert result.pod_name == f"skuld-{sample_session.id}"

    async def test_start_merges_session_defaults_with_spec(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        spec = make_spec()
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            await pod_manager.start(sample_session, spec)

        body = mock_api.create_namespaced_custom_object.call_args[1]["body"]
        values = body["spec"]["values"]
        assert values["image"]["repository"] == "ghcr.io/niuulabs/skuld"
        assert values["resources"]["requests"]["memory"] == "256Mi"

    async def test_start_spec_values_override_defaults(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        spec = make_spec(
            resources={"cpu": "4", "memory": "16Gi"},
            env={"CUDA_VISIBLE_DEVICES": "0"},
        )
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            await pod_manager.start(sample_session, spec)

        body = mock_api.create_namespaced_custom_object.call_args[1]["body"]
        values = body["spec"]["values"]
        # Dict values are shallow-merged: spec values are merged into defaults
        assert values["resources"]["cpu"] == "4"
        assert values["resources"]["memory"] == "16Gi"
        assert values["env"] == {"CUDA_VISIBLE_DEVICES": "0"}

    async def test_start_patches_on_conflict(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        spec = make_spec()
        mock_api.create_namespaced_custom_object.side_effect = Exception(
            "409 Conflict: AlreadyExists"
        )
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            await pod_manager.start(sample_session, spec)

        mock_api.patch_namespaced_custom_object.assert_called_once()


class TestFluxPodManagerStop:
    async def test_stop_deletes_helmrelease(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.stop(sample_session)

        assert result is True
        mock_api.delete_namespaced_custom_object.assert_called_once_with(
            group=HELMRELEASE_GROUP,
            version=HELMRELEASE_VERSION,
            namespace="test-ns",
            plural=HELMRELEASE_PLURAL,
            name=f"skuld-{sample_session.id}",
        )

    async def test_stop_returns_false_on_not_found(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.delete_namespaced_custom_object.side_effect = Exception("404 NotFound")
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.stop(sample_session)

        assert result is False


class TestFluxPodManagerStatus:
    async def test_status_running(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.get_namespaced_custom_object.return_value = {
            "status": {
                "conditions": [
                    {"type": "Ready", "status": "True"},
                ],
            },
        }
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.status(sample_session)

        assert result == SessionStatus.RUNNING

    async def test_status_starting(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.get_namespaced_custom_object.return_value = {
            "status": {
                "conditions": [
                    {"type": "Ready", "status": "False", "reason": "Progressing"},
                ],
            },
        }
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STARTING

    async def test_status_failed(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.get_namespaced_custom_object.return_value = {
            "status": {
                "conditions": [
                    {"type": "Ready", "status": "False", "reason": "InstallFailed"},
                ],
            },
        }
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.status(sample_session)

        assert result == SessionStatus.FAILED

    async def test_status_stopped_when_not_found(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.get_namespaced_custom_object.side_effect = Exception("404 NotFound")
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STOPPED

    async def test_status_starting_when_no_conditions(
        self, pod_manager: FluxPodManager, sample_session: Session, mock_api
    ):
        mock_api.get_namespaced_custom_object.return_value = {
            "status": {},
        }
        with patch.object(pod_manager, "_get_api", return_value=mock_api):
            result = await pod_manager.status(sample_session)

        assert result == SessionStatus.STARTING


class TestFluxPodManagerClose:
    async def test_close_when_no_client(self, pod_manager: FluxPodManager):
        await pod_manager.close()
        assert pod_manager._api_client is None

    async def test_close_closes_api_client(self, pod_manager: FluxPodManager):
        mock_client = AsyncMock()
        pod_manager._api_client = mock_client
        await pod_manager.close()
        mock_client.close.assert_called_once()
        assert pod_manager._api_client is None


class TestFluxPodManagerKwargsPattern:
    def test_accepts_extra_kwargs_without_error(self):
        pm = FluxPodManager(
            namespace="test",
            unknown_key="ignored",
            another_key=42,
        )
        assert pm._namespace == "test"

    def test_defaults_are_sensible(self):
        pm = FluxPodManager()
        assert pm._namespace == "default"
        assert pm._chart_name == "skuld"
        assert pm._base_domain == "volundr.local"


class TestFluxPodManagerGatewayEndpoints:
    """Tests for path-based endpoint generation with gateway_domain."""

    def test_host_based_endpoints_without_gateway_domain(self):
        pm = FluxPodManager(
            base_domain="volundr.example.com",
            chat_scheme="wss",
            code_scheme="https",
        )
        assert pm._chat_endpoint("my-session") == ("wss://my-session.volundr.example.com/session")
        assert pm._code_endpoint("my-session") == ("https://my-session.volundr.example.com/")

    def test_path_based_endpoints_with_gateway_domain(self):
        pm = FluxPodManager(
            gateway_domain="gateway.example.com",
            base_domain="volundr.example.com",
        )
        sid = "abc-123"
        assert pm._chat_endpoint("my-session", sid) == (
            "wss://gateway.example.com/s/abc-123/session"
        )
        assert pm._code_endpoint("my-session", sid) == ("https://gateway.example.com/s/abc-123/")

    async def test_start_returns_path_based_endpoints(
        self,
        sample_session: Session,
        mock_api,
    ):
        pm = FluxPodManager(
            namespace="test-ns",
            gateway_domain="gateway.example.com",
            base_domain="volundr.example.com",
        )
        spec = make_spec()
        with patch.object(pm, "_get_api", return_value=mock_api):
            result = await pm.start(sample_session, spec)

        session_id = str(sample_session.id)
        assert result.chat_endpoint == (f"wss://gateway.example.com/s/{session_id}/session")
        assert result.code_endpoint == (f"https://gateway.example.com/s/{session_id}/")


class TestFluxPodManagerSpecValues:
    """Tests for spec values pass-through to Skuld Helm values."""

    async def test_spec_values_passed_to_helmrelease(
        self,
        sample_session: Session,
        mock_api,
    ):
        pm = FluxPodManager(
            namespace="test-ns",
            base_domain="volundr.example.com",
        )
        spec = make_spec(
            gateway={
                "enabled": True,
                "name": "my-gw",
                "namespace": "my-ns",
            },
            git={"repoUrl": "https://github.com/org/repo", "branch": "main"},
        )
        with patch.object(pm, "_get_api", return_value=mock_api):
            await pm.start(sample_session, spec)

        body = mock_api.create_namespaced_custom_object.call_args[1]["body"]
        assert body["spec"]["values"]["gateway"]["enabled"] is True
        assert body["spec"]["values"]["gateway"]["name"] == "my-gw"
        assert body["spec"]["values"]["git"]["repoUrl"] == "https://github.com/org/repo"

    async def test_resource_overrides_reach_devrunner_values(
        self,
        sample_session: Session,
        mock_api,
    ):
        """Verify user resource config flows through to devrunner Helm values."""
        pm = FluxPodManager(
            namespace="test-ns",
            base_domain="volundr.example.com",
            session_defaults={
                "localServices": {
                    "devrunner": {
                        "resources": {
                            "requests": {"memory": "512Mi", "cpu": "100m"},
                            "limits": {"memory": "4Gi", "cpu": "2000m"},
                        }
                    }
                },
            },
        )
        spec = make_spec(
            localServices={
                "devrunner": {
                    "resources": {
                        "requests": {"cpu": "8", "memory": "32Gi"},
                        "limits": {"cpu": "8", "memory": "32Gi", "nvidia.com/gpu": "4"},
                    }
                }
            },
            nodeSelector={"nvidia.com/gpu.product": "H100"},
            tolerations=[{"key": "nvidia.com/gpu", "operator": "Exists", "effect": "NoSchedule"}],
            runtimeClassName="nvidia",
        )
        with patch.object(pm, "_get_api", return_value=mock_api):
            await pm.start(sample_session, spec)

        body = mock_api.create_namespaced_custom_object.call_args[1]["body"]
        values = body["spec"]["values"]
        # Devrunner resources should be overridden
        dr = values["localServices"]["devrunner"]["resources"]
        assert dr["requests"]["cpu"] == "8"
        assert dr["requests"]["memory"] == "32Gi"
        assert dr["limits"]["nvidia.com/gpu"] == "4"
        # Pod-level scheduling
        assert values["nodeSelector"]["nvidia.com/gpu.product"] == "H100"
        assert len(values["tolerations"]) == 1
        assert values["runtimeClassName"] == "nvidia"

    async def test_empty_spec_uses_only_defaults(
        self,
        sample_session: Session,
        mock_api,
    ):
        pm = FluxPodManager(
            namespace="test-ns",
            base_domain="volundr.example.com",
        )
        spec = make_spec()
        with patch.object(pm, "_get_api", return_value=mock_api):
            await pm.start(sample_session, spec)

        body = mock_api.create_namespaced_custom_object.call_args[1]["body"]
        assert "gateway" not in body["spec"]["values"]
