from __future__ import annotations

from pathlib import Path

from niuu.mesh.ipc import cleanup_ravn_mesh_sockets, flock_socket_dir, ipc_path, ravn_mesh_addresses
from ravn.cli.flock import FlockDef, NodeDef, _check_ports, _write_cluster_yaml, _write_node_config


def _node(tmp_path: Path, persona: str = "reviewer") -> NodeDef:
    return NodeDef(
        index=1,
        persona=persona,
        peer_id=f"flock-{persona}",
        pub_port=7505,
        rep_port=7506,
        handshake_port=7585,
        gateway_port=7700,
        config_path=str(tmp_path / f"node-{persona}.yaml"),
        log_path=str(tmp_path / "logs" / f"{persona}.log"),
    )


def test_write_node_config_uses_ipc_and_disables_gateway(tmp_path: Path) -> None:
    node = _node(tmp_path)

    _write_node_config(
        node,
        tmp_path,
        discovery="static",
        mesh_transport="ipc",
        http_gateway_enabled=False,
    )

    config = Path(node.config_path).read_text(encoding="utf-8")
    pub_address, rep_address = ravn_mesh_addresses(tmp_path, node.persona)
    assert f'pub_sub_address: "{pub_address}"' in config
    assert f'req_rep_address: "{rep_address}"' in config
    assert "enabled: false" in config
    assert "port:" not in config


def test_write_cluster_yaml_uses_ipc_addresses(tmp_path: Path) -> None:
    node = _node(tmp_path)

    _write_cluster_yaml([node], tmp_path, mesh_transport="ipc")

    cluster = (tmp_path / "cluster.yaml").read_text(encoding="utf-8")
    pub_address, rep_address = ravn_mesh_addresses(tmp_path, node.persona)
    assert f'pub_address: "{pub_address}"' in cluster
    assert f'rep_address: "{rep_address}"' in cluster


def test_ipc_socket_paths_use_short_tmp_namespace(tmp_path: Path) -> None:
    deep_flock_dir = tmp_path / "very" / "deep" / "workspace" / ("x" * 120) / ".flock"

    sock_dir = flock_socket_dir(deep_flock_dir)
    pub_address, rep_address = ravn_mesh_addresses(deep_flock_dir, "reviewer")

    assert sock_dir.parent.name == "niuu-mesh"
    assert len(str(sock_dir)) < 80
    assert pub_address.startswith("ipc:///")
    assert rep_address.startswith("ipc:///")
    assert len(pub_address) < 104
    assert len(rep_address) < 104


def test_cleanup_ravn_mesh_sockets_keeps_socket_directory(tmp_path: Path) -> None:
    sock_dir = flock_socket_dir(tmp_path)
    sock_dir.mkdir(parents=True, exist_ok=True)
    pub_address, rep_address = ravn_mesh_addresses(tmp_path, "reviewer")
    for address in (pub_address, rep_address):
        path = ipc_path(address)
        assert path is not None
        path.touch()

    cleanup_ravn_mesh_sockets(tmp_path, ["reviewer"])

    assert sock_dir.exists()
    assert list(sock_dir.iterdir()) == []


def test_check_ports_skips_mesh_and_gateway_for_ipc_static() -> None:
    flock_def = FlockDef(
        base_port=7480,
        discovery="static",
        mesh_transport="ipc",
        http_gateway_enabled=False,
        nodes=[_node(Path("/tmp"))],
    )

    assert _check_ports(flock_def) == []
