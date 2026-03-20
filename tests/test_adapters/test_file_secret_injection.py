"""Tests for FileSecretInjectionAdapter."""

import pytest

from volundr.adapters.outbound.file_secret_injection import FileSecretInjectionAdapter


class TestFileSecretInjectionAdapter:
    @pytest.fixture
    def adapter(self, tmp_path):
        return FileSecretInjectionAdapter(base_dir=str(tmp_path))

    async def test_pod_spec_returns_hostpath_volume(self, adapter, tmp_path):
        result = await adapter.pod_spec_additions("user-1", "sess-123")

        assert len(result.volumes) == 1
        vol = result.volumes[0]
        assert vol["name"] == "secrets-sess-123"
        assert vol["hostPath"]["path"] == f"{tmp_path}/user/user-1"
        assert vol["hostPath"]["type"] == "DirectoryOrCreate"

    async def test_pod_spec_returns_volume_mount(self, adapter):
        result = await adapter.pod_spec_additions("user-1", "sess-123")

        assert len(result.volume_mounts) == 1
        mount = result.volume_mounts[0]
        assert mount["name"] == "secrets-sess-123"
        assert mount["mountPath"] == "/run/secrets/user"
        assert mount["readOnly"] is True

    async def test_ensure_spc_is_noop(self, adapter):
        await adapter.ensure_secret_provider_class("user-1", ["cred-a", "cred-b"])

    async def test_provision_user_is_noop(self, adapter):
        await adapter.provision_user("user-1")

    async def test_deprovision_user_is_noop(self, adapter):
        await adapter.deprovision_user("user-1")

    def test_accepts_extra_kwargs(self, tmp_path):
        adapter = FileSecretInjectionAdapter(base_dir=str(tmp_path), unknown="ignored")
        assert adapter is not None
