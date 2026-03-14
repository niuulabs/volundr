"""Tests for LocalMountContributor."""

import pytest

from volundr.adapters.outbound.contributors.local_mount import LocalMountContributor
from volundr.domain.models import GitSource, LocalMountSource, MountMapping, Session
from volundr.domain.ports import SessionContext


def _make_session(source=None):
    return Session(
        name="test",
        model="claude",
        source=source or GitSource(repo="https://github.com/org/repo", branch="main"),
    )


class TestLocalMountContributor:
    async def test_name(self):
        c = LocalMountContributor()
        assert c.name == "local_mount"

    async def test_non_local_mount_source_returns_empty(self):
        session = _make_session(source=GitSource(repo="https://github.com/org/repo", branch="main"))
        c = LocalMountContributor(enabled=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is None

    async def test_disabled_returns_empty(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[MountMapping(host_path="/home/user/code", mount_path="/workspace")],
            ),
        )
        c = LocalMountContributor(enabled=False)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is None

    async def test_valid_paths_contribute_volumes(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[MountMapping(host_path="/home/user/code", mount_path="/workspace")],
            ),
        )
        c = LocalMountContributor(enabled=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is not None
        assert len(result.pod_spec.volumes) == 1
        assert result.pod_spec.volumes[0]["name"] == "local-mount-0"
        assert result.pod_spec.volumes[0]["hostPath"]["path"] == "/home/user/code"
        assert result.pod_spec.volumes[0]["hostPath"]["type"] == "Directory"
        assert len(result.pod_spec.volume_mounts) == 1
        assert result.pod_spec.volume_mounts[0]["name"] == "local-mount-0"
        assert result.pod_spec.volume_mounts[0]["mountPath"] == "/workspace"

    async def test_path_not_in_allowed_prefixes_raises(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[MountMapping(host_path="/etc/secret", mount_path="/workspace")],
            ),
        )
        c = LocalMountContributor(enabled=True, allowed_prefixes=["/home", "/tmp"])
        with pytest.raises(ValueError, match="not under any allowed prefix"):
            await c.contribute(session, SessionContext())

    async def test_root_path_blocked_by_default(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[MountMapping(host_path="/", mount_path="/host-root")],
            ),
        )
        c = LocalMountContributor(enabled=True, allow_root_mount=False)
        with pytest.raises(ValueError, match="allow_root_mount"):
            await c.contribute(session, SessionContext())

    async def test_root_path_allowed_when_configured(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[MountMapping(host_path="/", mount_path="/host-root")],
            ),
        )
        c = LocalMountContributor(enabled=True, allow_root_mount=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is not None
        assert result.pod_spec.volumes[0]["hostPath"]["path"] == "/"

    async def test_multiple_mount_paths(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[
                    MountMapping(host_path="/home/user/code", mount_path="/workspace"),
                    MountMapping(host_path="/home/user/data", mount_path="/data"),
                ],
            ),
        )
        c = LocalMountContributor(enabled=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is not None
        assert len(result.pod_spec.volumes) == 2
        assert len(result.pod_spec.volume_mounts) == 2
        assert result.pod_spec.volumes[0]["name"] == "local-mount-0"
        assert result.pod_spec.volumes[1]["name"] == "local-mount-1"
        assert result.pod_spec.volume_mounts[0]["mountPath"] == "/workspace"
        assert result.pod_spec.volume_mounts[1]["mountPath"] == "/data"

    async def test_read_only_flag(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[
                    MountMapping(
                        host_path="/home/user/code",
                        mount_path="/workspace",
                        read_only=False,
                    ),
                ],
            ),
        )
        c = LocalMountContributor(enabled=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is not None
        assert result.pod_spec.volume_mounts[0]["readOnly"] is False

    async def test_read_only_default_is_true(self):
        session = _make_session(
            source=LocalMountSource(
                paths=[
                    MountMapping(host_path="/home/user/code", mount_path="/workspace"),
                ],
            ),
        )
        c = LocalMountContributor(enabled=True)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is not None
        assert result.pod_spec.volume_mounts[0]["readOnly"] is True
