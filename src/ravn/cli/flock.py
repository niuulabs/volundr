"""ravn flock — local multi-node Ravn mesh supervisor (NIU-xxx).

Manages a set of ``ravn daemon`` child processes, each with a distinct
persona and unique nng ports, forming a local Pi-mode mesh for development
and testing.

Commands
--------
  ravn flock start [PERSONAS...]  — spin up N daemon nodes
  ravn flock stop                 — graceful shutdown of all nodes
  ravn flock status               — show live/dead status table
  ravn flock list                 — list available personas
  ravn flock peers                — list verified flock members (via node 0)
  ravn flock logs [--node NAME]   — tail logs for one or all nodes
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import typer

# ---------------------------------------------------------------------------
# Typer app
# ---------------------------------------------------------------------------

flock_app = typer.Typer(
    name="flock",
    help="Manage a local multi-node Ravn flock (mesh of daemon processes).",
    add_completion=False,
)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_PERSONAS = ["coordinator", "coding-agent", "research-agent"]
_DEFAULT_BASE_PORT = 7480
_SPAWN_STAGGER_S = 0.5  # seconds between node spawns


def _flock_dir_default() -> Path:
    return Path.home() / ".ravn" / "flock"


# ---------------------------------------------------------------------------
# State model
# ---------------------------------------------------------------------------


@dataclass
class NodeState:
    index: int
    persona: str
    peer_id: str
    pid: int
    pub_port: int
    rep_port: int
    handshake_port: int
    config_path: str
    log_path: str


@dataclass
class FlockState:
    started_at: str
    base_port: int
    nodes: list[NodeState] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_json(self) -> str:
        return json.dumps(
            {
                "started_at": self.started_at,
                "base_port": self.base_port,
                "nodes": [asdict(n) for n in self.nodes],
            },
            indent=2,
        )

    @classmethod
    def from_json(cls, text: str) -> FlockState:
        data = json.loads(text)
        nodes = [NodeState(**n) for n in data.get("nodes", [])]
        return cls(
            started_at=data["started_at"],
            base_port=data["base_port"],
            nodes=nodes,
        )


def _state_path(flock_dir: Path) -> Path:
    return flock_dir / "state.json"


def _load_state(flock_dir: Path) -> FlockState | None:
    path = _state_path(flock_dir)
    if not path.exists():
        return None
    return FlockState.from_json(path.read_text())


def _save_state(state: FlockState, flock_dir: Path) -> None:
    """Write state.json atomically."""
    path = _state_path(flock_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(state.to_json())
    os.replace(tmp, path)


def _delete_state(flock_dir: Path) -> None:
    _state_path(flock_dir).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------


def _ports_for(index: int, base_port: int) -> tuple[int, int, int]:
    """Return (pub_port, rep_port, handshake_port) for node at *index*."""
    pub = base_port + (index * 2)
    rep = base_port + (index * 2) + 1
    hs = base_port + 100 + index
    return pub, rep, hs


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _check_ports(personas: list[str], base_port: int) -> list[int]:
    """Return a list of ports that are already in use."""
    taken = []
    for i in range(len(personas)):
        for port in _ports_for(i, base_port):
            if not _port_free(port):
                taken.append(port)
    return taken


# ---------------------------------------------------------------------------
# Process liveness
# ---------------------------------------------------------------------------


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _any_alive(state: FlockState) -> bool:
    return any(_is_alive(n.pid) for n in state.nodes)


# ---------------------------------------------------------------------------
# Config file generation
# ---------------------------------------------------------------------------


def _write_node_config(node: NodeState, flock_dir: Path) -> None:
    config_path = Path(node.config_path)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        f"""\
# Auto-generated by ravn flock start — do not edit.
# Node {node.index}: {node.persona}

mesh:
  enabled: true
  adapter: nng
  own_peer_id: "{node.peer_id}"
  nng:
    pub_sub_address: "tcp://0.0.0.0:{node.pub_port}"
    req_rep_address: "tcp://0.0.0.0:{node.rep_port}"

discovery:
  enabled: true
  adapter: mdns
  mdns:
    handshake_port: {node.handshake_port}

cascade:
  enabled: true

initiative:
  enabled: true
  max_concurrent_tasks: 3
  queue_journal_path: "{flock_dir}/{node.persona}-queue.json"

memory:
  backend: sqlite
  sqlite:
    path: "{flock_dir}/{node.persona}.db"

logging:
  level: INFO
"""
    )


# ---------------------------------------------------------------------------
# Spawn / teardown
# ---------------------------------------------------------------------------


def _spawn_node(node: NodeState, flock_dir: Path) -> int:
    """Start the daemon process and return its PID."""
    log_path = Path(node.log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_fd = open(log_path, "a")  # noqa: WPS515 — intentionally left open for child

    proc = subprocess.Popen(
        [sys.executable, "-m", "ravn", "daemon", "--persona", node.persona],
        env={**os.environ, "RAVN_CONFIG": node.config_path},
        stdout=log_fd,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,  # detach from parent's process group
    )
    log_fd.close()  # parent closes its copy; child keeps the fd via inheritance
    return proc.pid


def _stop_nodes(state: FlockState, *, timeout_s: float = 5.0) -> None:
    """Send SIGTERM to all nodes, then SIGKILL stragglers."""
    for node in state.nodes:
        if _is_alive(node.pid):
            try:
                os.kill(node.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not any(_is_alive(n.pid) for n in state.nodes):
            return
        time.sleep(0.2)

    for node in state.nodes:
        if _is_alive(node.pid):
            try:
                os.kill(node.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


@flock_app.command("start")
def flock_start(
    personas: list[str] = typer.Argument(
        default=None,
        help="Persona names to run as nodes. Defaults to: coordinator coding-agent research-agent.",
    ),
    base_port: int = typer.Option(
        _DEFAULT_BASE_PORT,
        "--base-port",
        help="First nng port. Ports base, base+1 … are allocated sequentially per node.",
    ),
    flock_dir: str = typer.Option("", "--flock-dir", help="Override flock state directory."),
) -> None:
    """Start a local flock of Ravn daemons, one per persona.

    \b
    Examples:
      ravn flock start
      ravn flock start coordinator coding-agent research-agent
      ravn flock start --base-port 8480 coordinator coding-agent
    """
    resolved_dir = Path(flock_dir) if flock_dir else _flock_dir_default()
    resolved_personas = list(personas) if personas else list(_DEFAULT_PERSONAS)

    # Guard: refuse if a live flock already exists.
    existing = _load_state(resolved_dir)
    if existing is not None and _any_alive(existing):
        typer.echo(
            "A flock is already running. Run 'ravn flock stop' first.", err=True
        )
        raise typer.Exit(1)

    # Pre-flight: verify all required ports are free.
    taken = _check_ports(resolved_personas, base_port)
    if taken:
        typer.echo(
            f"Ports already in use: {taken}. Use --base-port to pick a different range.",
            err=True,
        )
        raise typer.Exit(1)

    # Validate personas exist before spawning anything.
    from ravn.adapters.personas.loader import PersonaLoader  # noqa: PLC0415

    loader = PersonaLoader()
    for persona in resolved_personas:
        if loader.load(persona) is None:
            typer.echo(
                f"Unknown persona {persona!r}. Run 'ravn flock list' to see available personas.",
                err=True,
            )
            raise typer.Exit(1)

    resolved_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = resolved_dir / "logs"
    logs_dir.mkdir(exist_ok=True)

    # Build node descriptors (without PIDs yet).
    nodes: list[NodeState] = []
    for i, persona in enumerate(resolved_personas):
        pub, rep, hs = _ports_for(i, base_port)
        nodes.append(
            NodeState(
                index=i,
                persona=persona,
                peer_id=f"flock-{persona}",
                pid=0,
                pub_port=pub,
                rep_port=rep,
                handshake_port=hs,
                config_path=str(resolved_dir / f"node-{persona}.yaml"),
                log_path=str(logs_dir / f"{persona}.log"),
            )
        )

    # Write config files.
    for node in nodes:
        _write_node_config(node, resolved_dir)

    typer.echo(f"Starting flock ({len(nodes)} nodes)…")
    typer.echo(f"  State dir: {resolved_dir}")
    typer.echo("")

    # Spawn workers first (all except index 0 if coordinator is first),
    # then coordinator last so workers are announcing before it needs them.
    spawn_order = list(range(1, len(nodes))) + [0]

    state = FlockState(
        started_at=datetime.now(UTC).isoformat(),
        base_port=base_port,
        nodes=nodes,
    )

    for i in spawn_order:
        node = nodes[i]
        pid = _spawn_node(node, resolved_dir)
        node.pid = pid
        typer.echo(
            f"  [{node.index}] {node.persona:<22} pid={pid}  "
            f"pub={node.pub_port}  rep={node.rep_port}  hs={node.handshake_port}"
        )
        if i != spawn_order[-1]:
            time.sleep(_SPAWN_STAGGER_S)

    _save_state(state, resolved_dir)

    typer.echo("")
    typer.echo("Flock started. Nodes will discover each other via mDNS (~3s).")
    typer.echo("")
    typer.echo("  ravn flock status   — check health")
    typer.echo("  ravn flock peers    — list verified flock members")
    typer.echo("  ravn flock logs     — tail all logs")
    typer.echo("  ravn flock stop     — shut everything down")


@flock_app.command("stop")
def flock_stop(
    flock_dir: str = typer.Option("", "--flock-dir", help="Override flock state directory."),
) -> None:
    """Stop all running flock nodes."""
    resolved_dir = Path(flock_dir) if flock_dir else _flock_dir_default()
    state = _load_state(resolved_dir)
    if state is None:
        typer.echo("No flock state found.")
        return

    typer.echo(f"Stopping {len(state.nodes)} node(s)…")
    _stop_nodes(state)

    # Clean up generated configs (keep logs for post-mortem).
    for node in state.nodes:
        Path(node.config_path).unlink(missing_ok=True)
    _delete_state(resolved_dir)

    typer.echo("Flock stopped.")


@flock_app.command("status")
def flock_status(
    flock_dir: str = typer.Option("", "--flock-dir", help="Override flock state directory."),
) -> None:
    """Show the status of each flock node."""
    resolved_dir = Path(flock_dir) if flock_dir else _flock_dir_default()
    state = _load_state(resolved_dir)
    if state is None:
        typer.echo("No flock running.")
        return

    typer.echo(f"Flock nodes ({len(state.nodes)})  [base-port={state.base_port}]")
    typer.echo("")
    for node in state.nodes:
        alive = _is_alive(node.pid)
        status_tag = "running" if alive else "DEAD"
        typer.echo(
            f"  [{node.index}] {node.persona:<22} pid={node.pid:<7} "
            f"pub={node.pub_port}  rep={node.rep_port}  hs={node.handshake_port}  "
            f"[{status_tag}]"
        )


@flock_app.command("list")
def flock_list() -> None:
    """List available personas (built-in and user-defined)."""
    from ravn.adapters.personas.loader import PersonaLoader  # noqa: PLC0415

    loader = PersonaLoader()
    builtin_names = set(loader.list_builtin_names())
    all_names = sorted(loader.list_names())

    typer.echo("Available personas:")
    typer.echo("")
    for name in all_names:
        persona = loader.load(name)
        source = "[built-in]" if name in builtin_names else f"[~/.ravn/personas/{name}.yaml]"
        allowed = ", ".join(persona.allowed_tools) if persona and persona.allowed_tools else "all"
        typer.echo(f"  {name:<24} {source:<40}  tools: {allowed}")


@flock_app.command("peers")
def flock_peers(
    node: int = typer.Option(
        0,
        "--node",
        "-n",
        help="Node index to query (default: 0, the first node).",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show address and latency."),
    flock_dir: str = typer.Option("", "--flock-dir", help="Override flock state directory."),
) -> None:
    """List verified flock members via the selected node's discovery config."""
    resolved_dir = Path(flock_dir) if flock_dir else _flock_dir_default()
    state = _load_state(resolved_dir)
    if state is None:
        typer.echo("No flock running.", err=True)
        raise typer.Exit(1)

    # Pick the requested node; fall back to first alive if it is dead.
    target = next((n for n in state.nodes if n.index == node), None)
    if target is None or not _is_alive(target.pid):
        target = next((n for n in state.nodes if _is_alive(n.pid)), None)
    if target is None:
        typer.echo("No live flock nodes found.", err=True)
        raise typer.Exit(1)

    # Lazy import to avoid circular dependency at module load time.
    from ravn.cli.commands import _run_peers  # noqa: PLC0415
    from ravn.config import Settings  # noqa: PLC0415

    os.environ["RAVN_CONFIG"] = target.config_path
    settings = Settings()
    asyncio.run(_run_peers(settings, verbose=verbose, force_scan=False))


@flock_app.command("logs")
def flock_logs(
    node: str = typer.Option(
        "",
        "--node",
        "-n",
        help="Persona name or node index to tail. Defaults to all nodes.",
    ),
    follow: bool = typer.Option(True, "--follow/--no-follow", "-f/-F", help="Follow log output."),
    lines: int = typer.Option(20, "--lines", "-l", help="Number of initial lines to show."),
    flock_dir: str = typer.Option("", "--flock-dir", help="Override flock state directory."),
) -> None:
    """Tail logs for one or all flock nodes."""
    resolved_dir = Path(flock_dir) if flock_dir else _flock_dir_default()
    state = _load_state(resolved_dir)
    if state is None:
        typer.echo("No flock state found.", err=True)
        raise typer.Exit(1)

    # Resolve which nodes to tail.
    target_nodes: list[NodeState]
    if not node:
        target_nodes = state.nodes
    elif node.isdigit():
        idx = int(node)
        target_nodes = [n for n in state.nodes if n.index == idx]
    else:
        target_nodes = [n for n in state.nodes if n.persona == node]

    if not target_nodes:
        typer.echo(f"No node matching {node!r}.", err=True)
        raise typer.Exit(1)

    log_paths = [n.log_path for n in target_nodes if Path(n.log_path).exists()]
    if not log_paths:
        typer.echo("No log files found yet.", err=True)
        raise typer.Exit(1)

    # Use `tail` if available, otherwise fall back to pure Python.
    tail_bin = _find_tail()
    if tail_bin:
        cmd = [tail_bin, f"-n{lines}"]
        if follow:
            cmd.append("-f")
        cmd.extend(log_paths)
        try:
            subprocess.run(cmd)
        except KeyboardInterrupt:
            pass
        return

    # Pure-Python fallback (Windows / environments without tail).
    _python_tail(log_paths, lines=lines, follow=follow)


# ---------------------------------------------------------------------------
# Internal helpers for flock logs
# ---------------------------------------------------------------------------


def _find_tail() -> str | None:
    for candidate in ("/usr/bin/tail", "/bin/tail"):
        if Path(candidate).exists():
            return candidate
    return None


def _python_tail(paths: list[str], *, lines: int, follow: bool) -> None:
    """Minimal pure-Python tail — prints last *lines* then optionally follows."""
    handles = []
    for p in paths:
        try:
            handles.append((p, open(p)))  # noqa: WPS515
        except OSError:
            pass

    # Print last N lines from each file.
    for path, fh in handles:
        content = fh.read().splitlines()
        header = f"==> {path} <=="
        typer.echo(header)
        for line in content[-lines:]:
            typer.echo(line)

    if not follow:
        for _, fh in handles:
            fh.close()
        return

    # Follow mode: poll all open file handles.
    try:
        while True:
            for path, fh in handles:
                chunk = fh.read()
                if chunk:
                    typer.echo(chunk, nl=False)
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        for _, fh in handles:
            fh.close()
