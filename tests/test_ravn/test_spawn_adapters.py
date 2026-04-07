"""Tests for SubprocessSpawnAdapter and KubernetesJobSpawnAdapter.

All tests mock the underlying infrastructure (subprocess creation, k8s API)
so no real processes or cluster is needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.spawn.subprocess_spawn import SubprocessSpawnAdapter
from ravn.ports.spawn import SpawnConfig, SpawnPort

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_config(persona: str = "worker") -> SpawnConfig:
    return SpawnConfig(
        persona=persona,
        caps=["bash"],
        permission_mode="workspace_write",
        max_concurrent_tasks=1,
    )


class _FakePeer:
    def __init__(self, persona: str = "worker"):
        self.persona = persona
        self.status = "idle"


class _FakeDiscovery:
    def __init__(self, sequence: list[dict]):
        """Each call to .peers() returns the next dict in *sequence*."""
        self._sequence = sequence
        self._idx = 0

    def peers(self) -> dict:
        if self._idx >= len(self._sequence):
            return self._sequence[-1]
        result = self._sequence[self._idx]
        self._idx += 1
        return result


# ---------------------------------------------------------------------------
# SpawnPort protocol
# ---------------------------------------------------------------------------


def test_subprocess_spawn_adapter_satisfies_protocol():
    """SubprocessSpawnAdapter must satisfy SpawnPort protocol."""
    discovery = MagicMock()
    adapter = SubprocessSpawnAdapter(discovery=discovery)
    assert isinstance(adapter, SpawnPort)


# ---------------------------------------------------------------------------
# SubprocessSpawnAdapter tests
# ---------------------------------------------------------------------------


class TestSubprocessSpawnAdapter:
    @pytest.mark.asyncio
    async def test_spawn_success(self):
        """spawn() starts a subprocess and returns peer_id once registered."""
        # Discovery: first call returns empty, second returns new peer
        peer = _FakePeer("worker")
        discovery = _FakeDiscovery([{}, {"peer-new": peer}])

        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = None

        with patch(
            "asyncio.create_subprocess_exec", new=AsyncMock(return_value=mock_proc)
        ):
            with patch(
                "ravn.adapters.spawn.subprocess_spawn.SubprocessSpawnAdapter._write_config"
            ) as mock_write:
                from pathlib import Path  # noqa: PLC0415

                mock_write.return_value = Path("/tmp/ravn_test.yaml")
                adapter = SubprocessSpawnAdapter(
                    discovery=discovery,
                    spawn_timeout_s=5.0,
                    ravn_executable="ravn",
                )
                adapter._poll_interval_s = 0.01
                peer_ids = await adapter.spawn(1, _make_config())

        assert len(peer_ids) == 1
        assert peer_ids[0] == "peer-new"

    @pytest.mark.asyncio
    async def test_spawn_timeout(self):
        """spawn() raises TimeoutError when peer never registers."""
        # Discovery always returns empty
        discovery = _FakeDiscovery([{}])

        mock_proc = MagicMock()
        mock_proc.pid = 99999
        mock_proc.returncode = None
        mock_proc.terminate = MagicMock()

        with patch(
            "asyncio.create_subprocess_exec", new=AsyncMock(return_value=mock_proc)
        ):
            with patch(
                "ravn.adapters.spawn.subprocess_spawn.SubprocessSpawnAdapter._write_config"
            ) as mock_write:
                from pathlib import Path  # noqa: PLC0415

                mock_write.return_value = Path("/tmp/ravn_test.yaml")
                adapter = SubprocessSpawnAdapter(
                    discovery=discovery,
                    spawn_timeout_s=0.05,
                )
                adapter._poll_interval_s = 0.01

                with pytest.raises(TimeoutError, match="did not register"):
                    await adapter.spawn(1, _make_config())

        mock_proc.terminate.assert_called_once()

    @pytest.mark.asyncio
    async def test_terminate_known_peer(self):
        """terminate() terminates the subprocess for a known peer."""
        discovery = MagicMock()
        mock_proc = MagicMock()
        mock_proc.returncode = None
        mock_proc.terminate = MagicMock()
        mock_proc.wait = AsyncMock()

        from pathlib import Path  # noqa: PLC0415

        adapter = SubprocessSpawnAdapter(discovery=discovery)
        adapter._spawned["peer-1"] = (mock_proc, Path("/tmp/cfg.yaml"))

        await adapter.terminate("peer-1")

        mock_proc.terminate.assert_called_once()
        assert "peer-1" not in adapter._spawned

    @pytest.mark.asyncio
    async def test_terminate_unknown_peer(self):
        """terminate() for unknown peer_id logs a warning but doesn't raise."""
        discovery = MagicMock()
        adapter = SubprocessSpawnAdapter(discovery=discovery)
        # Should not raise
        await adapter.terminate("no-such-peer")

    @pytest.mark.asyncio
    async def test_terminate_all(self):
        """terminate_all() terminates all spawned instances."""
        discovery = MagicMock()
        mock_proc_1 = MagicMock()
        mock_proc_1.returncode = None
        mock_proc_1.terminate = MagicMock()
        mock_proc_1.wait = AsyncMock()

        mock_proc_2 = MagicMock()
        mock_proc_2.returncode = None
        mock_proc_2.terminate = MagicMock()
        mock_proc_2.wait = AsyncMock()

        from pathlib import Path  # noqa: PLC0415

        adapter = SubprocessSpawnAdapter(discovery=discovery)
        adapter._spawned["p1"] = (mock_proc_1, Path("/tmp/cfg1.yaml"))
        adapter._spawned["p2"] = (mock_proc_2, Path("/tmp/cfg2.yaml"))

        await adapter.terminate_all()

        mock_proc_1.terminate.assert_called_once()
        mock_proc_2.terminate.assert_called_once()
        assert len(adapter._spawned) == 0

    @pytest.mark.asyncio
    async def test_terminate_already_exited(self):
        """terminate() on already-exited process (returncode set) skips terminate call."""
        discovery = MagicMock()
        mock_proc = MagicMock()
        mock_proc.returncode = 0  # already exited
        mock_proc.terminate = MagicMock()

        from pathlib import Path  # noqa: PLC0415

        adapter = SubprocessSpawnAdapter(discovery=discovery)
        adapter._spawned["p1"] = (mock_proc, Path("/tmp/cfg.yaml"))

        await adapter.terminate("p1")

        mock_proc.terminate.assert_not_called()

    def test_write_config_produces_valid_file(self):
        """_write_config writes a config file with initiative section."""
        discovery = MagicMock()
        adapter = SubprocessSpawnAdapter(discovery=discovery)
        config = _make_config()

        path = adapter._write_config(config)
        assert path.exists()
        content = path.read_text()
        # YAML and JSON both include 'initiative' key
        assert "initiative" in content
        path.unlink(missing_ok=True)

    def test_write_config_with_yaml(self):
        """_write_config writes YAML when pyyaml is available."""
        discovery = MagicMock()
        adapter = SubprocessSpawnAdapter(discovery=discovery)
        config = SpawnConfig(
            persona="analyst",
            caps=["bash"],
            permission_mode="read_only",
            max_concurrent_tasks=2,
            ttl_minutes=30,
        )

        try:
            path = adapter._write_config(config)
            assert path.exists()
            content = path.read_text()
            assert "initiative" in content
        finally:
            path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# KubernetesJobSpawnAdapter tests (mocked k8s client)
# ---------------------------------------------------------------------------


class TestKubernetesJobSpawnAdapter:
    @pytest.mark.asyncio
    async def test_import_error_on_spawn_without_k8s(self):
        """_create_job raises RuntimeError when kubernetes client is missing."""
        from ravn.adapters.spawn.kubernetes_spawn import KubernetesJobSpawnAdapter  # noqa: PLC0415

        discovery = MagicMock()
        adapter = KubernetesJobSpawnAdapter(discovery=discovery)

        # Patch the kubernetes import to fail inside _create_job
        with patch(
            "ravn.adapters.spawn.kubernetes_spawn.KubernetesJobSpawnAdapter._create_job",
            side_effect=RuntimeError(
                "kubernetes Python client is required for KubernetesJobSpawnAdapter."
            ),
        ):
            with pytest.raises(RuntimeError, match="kubernetes Python client"):
                await adapter._create_job("test-job", _make_config())

    @pytest.mark.asyncio
    async def test_terminate_unknown_peer(self):
        """terminate() for unknown peer_id is a no-op."""
        from ravn.adapters.spawn.kubernetes_spawn import KubernetesJobSpawnAdapter  # noqa: PLC0415

        discovery = MagicMock()
        adapter = KubernetesJobSpawnAdapter(discovery=discovery)
        # Should not raise
        await adapter.terminate("no-such-peer")

    @pytest.mark.asyncio
    async def test_terminate_all_empty(self):
        """terminate_all() on empty spawner is a no-op."""
        from ravn.adapters.spawn.kubernetes_spawn import KubernetesJobSpawnAdapter  # noqa: PLC0415

        discovery = MagicMock()
        adapter = KubernetesJobSpawnAdapter(discovery=discovery)
        await adapter.terminate_all()  # no error

    @pytest.mark.asyncio
    async def test_spawn_timeout(self):
        """spawn() raises TimeoutError when peer never registers."""
        from ravn.adapters.spawn.kubernetes_spawn import KubernetesJobSpawnAdapter  # noqa: PLC0415

        discovery = _FakeDiscovery([{}])
        adapter = KubernetesJobSpawnAdapter(
            discovery=discovery,
            spawn_timeout_s=0.05,
        )
        adapter._poll_interval_s = 0.01

        # Mock _create_job so it doesn't need real k8s
        adapter._create_job = AsyncMock()
        adapter._delete_job = AsyncMock()

        with pytest.raises(TimeoutError, match="did not register"):
            await adapter.spawn(1, _make_config())

        adapter._delete_job.assert_called_once()

    @pytest.mark.asyncio
    async def test_spawn_success_mocked(self):
        """spawn() succeeds when peer appears after mock Job creation."""
        from ravn.adapters.spawn.kubernetes_spawn import KubernetesJobSpawnAdapter  # noqa: PLC0415

        peer = _FakePeer("worker")
        discovery = _FakeDiscovery([{}, {"spawned-k8s": peer}])
        adapter = KubernetesJobSpawnAdapter(
            discovery=discovery,
            spawn_timeout_s=5.0,
        )
        adapter._poll_interval_s = 0.01
        adapter._create_job = AsyncMock()

        peer_ids = await adapter.spawn(1, _make_config())

        assert peer_ids == ["spawned-k8s"]
        adapter._create_job.assert_called_once()
