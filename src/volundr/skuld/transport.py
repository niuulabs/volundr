"""CLI transport abstraction for communicating with AI coding CLIs.

Implementations:
- SubprocessTransport: spawns `claude -p` per message (Claude legacy)
- SdkWebSocketTransport: long-lived Claude process with `--sdk-url` WebSocket
- CodexSubprocessTransport: spawns `codex` per message (OpenAI Codex CLI)
"""

import asyncio
import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

logger = logging.getLogger("skuld.transport")

EventCallback = Callable[[dict], Awaitable[None]]


class CLITransport(ABC):
    """Abstract transport for communicating with Claude Code CLI."""

    def __init__(self) -> None:
        self._event_callback: EventCallback | None = None

    def on_event(self, callback: EventCallback) -> None:
        """Register a callback for CLI events (assistant, result, etc)."""
        self._event_callback = callback

    async def _emit(self, data: dict) -> None:
        """Fire the event callback if registered."""
        if not self._event_callback:
            logger.debug(
                "_emit: no callback registered, dropping type=%s",
                data.get("type"),
            )
            return
        await self._event_callback(data)

    @abstractmethod
    async def start(self) -> None:
        """Initialize the transport."""

    @abstractmethod
    async def stop(self) -> None:
        """Shut down the transport and clean up."""

    @abstractmethod
    async def send_message(self, content: str) -> None:
        """Send a user message to Claude Code."""

    async def send_control_response(self, request_id: str, response: dict) -> None:
        """Respond to a CLI-initiated control_request (e.g. can_use_tool).

        No-op for transports that don't support the control protocol.
        """

    async def send_control(self, subtype: str, **kwargs: object) -> None:
        """Send a server-initiated control message (e.g. interrupt, set_model).

        No-op for transports that don't support the control protocol.
        """

    @property
    @abstractmethod
    def session_id(self) -> str | None:
        """The CLI's session ID (for resume)."""

    @property
    @abstractmethod
    def last_result(self) -> dict | None:
        """The most recent result event (for usage reporting)."""

    @property
    @abstractmethod
    def is_alive(self) -> bool:
        """Whether the transport is connected and operational."""

    @property
    def supports_cli_websocket(self) -> bool:
        """Whether this transport uses the Claude SDK WebSocket protocol.

        Only SdkWebSocketTransport returns True. All other transports
        communicate via subprocess stdio and return False.
        """
        return False


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _filter_event(data: dict) -> dict | None:
    """Filter events before forwarding to the browser.

    Drops empty content_block_delta events (no text to display) and
    keep_alive messages (internal transport concern).
    """
    msg_type = data.get("type")

    if msg_type == "keep_alive":
        return None

    if msg_type == "content_block_delta":
        text = data.get("delta", {}).get("text", "")
        if not text:
            logger.debug("Filtering out empty content_block_delta event")
            return None

    logger.debug("_filter_event passing through event type=%s", msg_type)
    return data


async def _drain_stream(stream: asyncio.StreamReader | None, label: str) -> None:
    """Read and log a stream to prevent buffer fill blocking."""
    if stream is None:
        logger.debug("_drain_stream(%s): stream is None, nothing to drain", label)
        return

    line_count = 0
    try:
        while True:
            line = await stream.readline()
            if not line:
                break
            text = line.decode().rstrip()
            if text:
                line_count += 1
                logger.info("Claude CLI %s: %s", label, text)
    except Exception as e:
        logger.warning("Stream drain (%s) ended with error: %r", label, e)
    finally:
        logger.info("_drain_stream(%s): finished after %d lines", label, line_count)


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    """Terminate a subprocess gracefully, kill on timeout."""
    if process.returncode is not None:
        return

    logger.info("Stopping Claude Code CLI")
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5.0)
    except TimeoutError:
        logger.warning("Claude Code CLI did not terminate, killing")
        process.kill()
        await process.wait()


# ---------------------------------------------------------------------------
# SubprocessTransport — legacy path (one process per message)
# ---------------------------------------------------------------------------


class SubprocessTransport(CLITransport):
    """Spawns `claude -p` per message, reads stdout for JSON events.

    This is a refactor of the original ClaudeCodeProcess class, preserving
    identical behavior as a fallback transport.
    """

    def __init__(self, workspace_dir: str) -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._session_id: str | None = None
        self._last_result: dict | None = None

    async def start(self) -> None:
        logger.info("SubprocessTransport configured for %s", self.workspace_dir)

    async def stop(self) -> None:
        async with self._lock:
            if self._process is None:
                return
            await _stop_process(self._process)
            self._process = None

    async def send_message(self, content: str) -> None:
        self._last_result = None

        cmd = [
            "claude",
            "-p",
            content,
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]
        if self._session_id:
            cmd.extend(["--resume", self._session_id])

        logger.info("Running Claude CLI (session: %s)", self._session_id)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process = process

        stderr_task = asyncio.create_task(_drain_stream(process.stderr, "stderr"))

        try:
            if process.stdout is None:
                raise RuntimeError("Claude Code CLI stdout not available")

            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                raw = line.decode().strip()
                if not raw:
                    continue

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError as e:
                    logger.warning("Skipping non-JSON line: %s (%s)", raw[:200], e)
                    continue

                if data.get("session_id"):
                    self._session_id = data["session_id"]

                event_type = data.get("type", "unknown")

                if event_type == "result":
                    self._last_result = data

                filtered = _filter_event(data)
                if filtered:
                    await self._emit(filtered)

                if event_type == "result":
                    break

            exit_code = await process.wait()
            if exit_code != 0:
                raise RuntimeError(f"Claude Code CLI exited with code {exit_code}")
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
            self._process = None

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return self._process is not None


# ---------------------------------------------------------------------------
# SdkWebSocketTransport — new SDK path (long-lived process, WS bridge)
# ---------------------------------------------------------------------------


class SdkWebSocketTransport(CLITransport):
    """Long-lived CLI process that connects back via --sdk-url WebSocket.

    The CLI connects to ws://localhost:{port}/ws/cli/{session_id} and
    communicates using NDJSON messages over that WebSocket.
    """

    def __init__(
        self,
        workspace_dir: str,
        sdk_port: int,
        session_id: str,
        *,
        model: str = "",
        skip_permissions: bool = True,
        agent_teams: bool = False,
    ) -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self._sdk_port = sdk_port
        self._broker_session_id = session_id
        self._model = model
        self._skip_permissions = skip_permissions
        self._agent_teams = agent_teams
        self._process: asyncio.subprocess.Process | None = None
        self._cli_ws: WebSocket | None = None
        self._cli_connected = asyncio.Event()
        self._cli_session_id: str | None = None
        self._last_result: dict | None = None
        self._pending_messages: list[dict] = []
        self._keepalive_task: asyncio.Task | None = None
        self._receive_task: asyncio.Task | None = None
        self._alive = False
        self._spawning = False
        self._slash_commands: list[str] = []
        self._skills: list[str] = []

    @property
    def sdk_url(self) -> str:
        return f"ws://localhost:{self._sdk_port}/ws/cli/{self._broker_session_id}"

    async def start(self) -> None:
        if self._spawning:
            logger.info("start() called but already spawning, skipping")
            return
        await self._spawn()

    async def _spawn(self, resume_session_id: str | None = None) -> None:
        """Spawn the CLI process with --sdk-url."""
        self._spawning = True
        resume_id = resume_session_id or self._cli_session_id

        cmd = [
            "claude",
            "--sdk-url",
            self.sdk_url,
            "--print",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
        ]
        if self._model:
            cmd.extend(["--model", self._model])
        if self._skip_permissions:
            cmd.extend(["--permission-mode", "bypassPermissions"])
        cmd.extend(["-p", "placeholder"])
        if resume_id:
            cmd.extend(["--resume", resume_id])

        logger.info(
            "Spawning Claude CLI with --sdk-url %s (resume: %s, skip_perms: %s, teams: %s)",
            self.sdk_url,
            resume_id,
            self._skip_permissions,
            self._agent_teams,
        )

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        if self._agent_teams:
            env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"

        if "ANTHROPIC_API_KEY" not in env:
            logger.warning(
                "ANTHROPIC_API_KEY not found in environment — "
                "CLI may fail to authenticate with the API"
            )

        logger.debug("CLI spawn command: %s", " ".join(cmd))
        logger.debug("CLI spawn env: CLAUDECODE unset, AGENT_TEAMS=%s", self._agent_teams)

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        logger.info("CLI process spawned with PID %s", self._process.pid)
        asyncio.create_task(_drain_stream(self._process.stdout, "stdout"))
        asyncio.create_task(_drain_stream(self._process.stderr, "stderr"))

    async def stop(self) -> None:
        logger.info(
            "SdkWebSocketTransport.stop() called (alive=%s, process=%s, cli_ws=%s)",
            self._alive,
            self._process.pid if self._process else None,
            self._cli_ws is not None,
        )
        self._alive = False

        if self._keepalive_task and not self._keepalive_task.done():
            self._keepalive_task.cancel()

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()

        if self._cli_ws:
            try:
                await self._cli_ws.close()
            except Exception as e:
                logger.debug("Error closing CLI WS during stop: %r", e)
            self._cli_ws = None

        if self._process:
            await _stop_process(self._process)
            self._process = None

        self._cli_connected.clear()
        self._spawning = False
        logger.info("SdkWebSocketTransport stopped")

    async def attach_cli_websocket(self, ws: WebSocket) -> None:
        """Called when the CLI connects back to /ws/cli/{session_id}."""
        logger.info(
            "CLI WebSocket attaching (pending_messages=%d, had_previous_ws=%s)",
            len(self._pending_messages),
            self._cli_ws is not None,
        )
        await ws.accept()
        self._cli_ws = ws
        self._alive = True
        self._spawning = False
        self._cli_connected.set()
        logger.info("CLI WebSocket accepted and marked alive")

        if self._pending_messages:
            logger.info("Flushing %d pending messages to CLI", len(self._pending_messages))
            for msg in self._pending_messages:
                logger.debug("Flushing pending message type=%s", msg.get("type"))
                await self._send_to_cli(msg)
            self._pending_messages.clear()

        self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        self._receive_task = asyncio.create_task(self._receive_loop())
        logger.info("CLI WebSocket receive and keepalive loops started")

    async def _receive_loop(self) -> None:
        """Read messages from the CLI WebSocket and dispatch events."""
        logger.info("_receive_loop started")
        msg_count = 0
        try:
            while self._cli_ws:
                message = await self._cli_ws.receive()
                msg_type = message.get("type", "")

                if msg_type == "websocket.disconnect":
                    code = message.get("code", 1000)
                    logger.info("CLI WS disconnect frame: code=%s", code)
                    break

                raw = message.get("text")
                if raw is None:
                    raw_bytes = message.get("bytes")
                    if raw_bytes:
                        raw = raw_bytes.decode("utf-8", errors="replace")
                        logger.info(
                            "CLI WS binary frame (%d bytes)",
                            len(raw_bytes),
                        )
                    else:
                        logger.warning("CLI WS empty frame: %s", message)
                        continue

                if msg_count == 0:
                    logger.info(
                        "CLI WS first frame (%d bytes): %.500s",
                        len(raw),
                        raw,
                    )

                for line in raw.split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError as e:
                        logger.warning(
                            "Non-JSON from CLI WS: %s (%s)",
                            line[:200],
                            e,
                        )
                        continue

                    msg_count += 1
                    logger.info(
                        "CLI WS msg #%d type=%s subtype=%s",
                        msg_count,
                        data.get("type", "?"),
                        data.get("subtype", "?"),
                    )
                    await self._handle_cli_message(data)
        except Exception as e:
            logger.warning(
                "CLI WS receive loop exception: %r",
                e,
                exc_info=True,
            )
        finally:
            self._alive = False
            self._cli_ws = None
            self._cli_connected.clear()
            logger.info(
                "CLI WS receive loop ended after %d messages",
                msg_count,
            )

    async def _handle_cli_message(self, data: dict) -> None:
        """Process a single parsed message from the CLI."""
        msg_type = data.get("type", "unknown")
        logger.debug("_handle_cli_message: type=%s", msg_type)

        if msg_type == "system" and data.get("subtype") == "init":
            if data.get("session_id"):
                self._cli_session_id = data["session_id"]
            self._slash_commands = data.get("slash_commands", [])
            self._skills = data.get("skills", [])
            logger.info(
                "CLI init: session=%s model=%s tools=%s slash_commands=%d skills=%d",
                data.get("session_id"),
                data.get("model"),
                len(data.get("tools", [])),
                len(self._slash_commands),
                len(self._skills),
            )

        if data.get("session_id") and msg_type != "system":
            self._cli_session_id = data["session_id"]

        if msg_type == "result":
            self._last_result = data
            logger.info("CLI result event received (session=%s)", self._cli_session_id)

        filtered = _filter_event(data)
        if not filtered:
            logger.debug("_handle_cli_message: event type=%s filtered out", msg_type)
            return
        logger.debug("_handle_cli_message: emitting event type=%s to broker", msg_type)
        await self._emit(filtered)

    async def send_message(self, content: str) -> None:
        logger.info(
            "send_message: alive=%s, spawning=%s, pid=%s, cli_ws=%s, connected=%s, len=%d",
            self._alive,
            self._spawning,
            self._process.pid if self._process else None,
            self._cli_ws is not None,
            self._cli_connected.is_set(),
            len(content),
        )

        if not self._alive and not self._spawning and self._process is not None:
            logger.info("CLI process dead, re-spawning with --resume")
            await self._spawn()

        msg = {
            "type": "user",
            "message": {"role": "user", "content": content},
            "parent_tool_use_id": None,
            "session_id": self._cli_session_id or "",
        }

        if not self._cli_connected.is_set():
            logger.info(
                "CLI not connected yet, queuing message (pending=%d)",
                len(self._pending_messages) + 1,
            )
            self._pending_messages.append(msg)
            return

        self._last_result = None
        logger.debug("Sending message to CLI WebSocket")
        await self._send_to_cli(msg)

    async def send_control_response(self, request_id: str, response: dict) -> None:
        """Respond to a CLI-initiated control_request (e.g. can_use_tool)."""
        msg = {
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": response,
            },
        }
        logger.debug("Sending control_response for request %s", request_id)
        await self._send_to_cli(msg)

    async def send_control(self, subtype: str, **kwargs: object) -> None:
        """Send a server-initiated control message to the CLI."""
        msg = {
            "type": "control_response",
            "response": {
                "subtype": subtype,
                "request_id": str(uuid.uuid4()),
                **kwargs,
            },
        }
        logger.debug("Sending control %s to CLI", subtype)
        await self._send_to_cli(msg)

    async def _send_to_cli(self, msg: dict) -> None:
        """Send a JSON message to the CLI WebSocket as NDJSON (newline-delimited)."""
        if not self._cli_ws:
            logger.warning(
                "Cannot send to CLI: WS not connected (type=%s)",
                msg.get("type"),
            )
            return

        payload = json.dumps(msg) + "\n"
        try:
            await self._cli_ws.send_text(payload)
        except Exception as e:
            logger.error(
                "Failed to send to CLI WS: %r (type=%s)",
                e,
                msg.get("type"),
                exc_info=True,
            )
            self._alive = False

    async def _keepalive_loop(self) -> None:
        """Send keep_alive messages every 10 seconds."""
        try:
            while self._alive:
                await asyncio.sleep(10)
                if self._cli_ws:
                    await self._send_to_cli({"type": "keep_alive"})
        except asyncio.CancelledError:
            pass  # Expected: keepalive loop cancelled during shutdown

    async def wait_for_cli_disconnect(self) -> None:
        """Block until the CLI WebSocket disconnects."""
        logger.debug(
            "wait_for_cli_disconnect: task=%s",
            self._receive_task is not None,
        )
        if self._receive_task:
            try:
                await self._receive_task
            except asyncio.CancelledError:
                logger.debug("wait_for_cli_disconnect: receive task cancelled")
        logger.debug("wait_for_cli_disconnect: done")

    @property
    def session_id(self) -> str | None:
        return self._cli_session_id

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return self._alive or self._spawning

    @property
    def slash_commands(self) -> list[str]:
        return self._slash_commands

    @property
    def skills(self) -> list[str]:
        return self._skills

    @property
    def supports_cli_websocket(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Tool name mapping — Codex → normalized names (matching Claude's tool names)
# ---------------------------------------------------------------------------

_CODEX_TOOL_MAP: dict[str, str] = {
    "shell": "Bash",
    "container.exec": "Bash",
    "str_replace_editor": "Edit",
    "str_replace_based_edit_tool": "Edit",
    "write_file": "Write",
    "create_file": "Write",
    "read_file": "Read",
    "list_directory": "LS",
    "search_files": "Grep",
}


def _map_codex_tool(codex_name: str) -> str:
    """Map a Codex CLI tool name to its normalized equivalent."""
    return _CODEX_TOOL_MAP.get(codex_name, codex_name)


# ---------------------------------------------------------------------------
# CodexSubprocessTransport — OpenAI Codex CLI (one process per message)
# ---------------------------------------------------------------------------


class CodexSubprocessTransport(CLITransport):
    """Spawns the OpenAI Codex CLI as a subprocess per message.

    Codex CLI reference: https://github.com/openai/codex

    Authentication: set OPENAI_API_KEY in the environment.

    Codex does not implement the Claude SDK WebSocket protocol, so
    supports_cli_websocket returns False and the /ws/cli endpoint is not used.

    Events emitted by Codex are normalized to the same format the broker
    expects so the rest of the pipeline (browser rendering, artifact tracking,
    usage reporting) works without change.  Where Codex does not provide
    structured usage data a synthetic ``modelUsage`` block with zero counts
    is emitted so the broker's result-handling path still fires.
    """

    def __init__(self, workspace_dir: str, model: str = "o4-mini") -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self._model = model
        self._process: asyncio.subprocess.Process | None = None
        self._last_result: dict | None = None
        self._pending_text: list[str] = []

    async def start(self) -> None:
        logger.info(
            "CodexSubprocessTransport configured for %s (model: %s)",
            self.workspace_dir,
            self._model,
        )

    async def stop(self) -> None:
        if self._process is None:
            return
        await _stop_process(self._process)
        self._process = None

    async def send_message(self, content: str) -> None:
        self._last_result = None
        self._pending_text = []

        cmd = [
            "codex",
            "--model",
            self._model,
            "--full-auto",  # skip all human confirmations
            "--quiet",  # minimal UI chrome, structured output
            content,
        ]

        logger.info("Running Codex CLI (model: %s)", self._model)
        logger.debug("Codex CLI command: %s", " ".join(cmd))

        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process = process

        stderr_task = asyncio.create_task(_drain_stream(process.stderr, "codex-stderr"))

        try:
            if process.stdout is None:
                raise RuntimeError("Codex CLI stdout not available")

            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                raw = line.decode().strip()
                if not raw:
                    continue

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    # Plain text output — emit as streaming text delta
                    event = {
                        "type": "content_block_delta",
                        "delta": {"type": "text_delta", "text": raw + "\n"},
                    }
                    self._pending_text.append(raw)
                    filtered = _filter_event(event)
                    if filtered:
                        await self._emit(filtered)
                    continue

                await self._handle_codex_event(data)

            exit_code = await process.wait()

            # Synthesize a result event if Codex didn't emit one
            if self._last_result is None:
                self._last_result = self._make_synthetic_result(exit_code)
                await self._emit(self._last_result)

        finally:
            if not stderr_task.done():
                stderr_task.cancel()
            self._process = None

    async def _handle_codex_event(self, data: dict) -> None:
        """Normalize a Codex CLI JSON event to the broker's common format."""
        event_type = data.get("type", "")
        logger.debug("Codex event: type=%s", event_type)

        # --- Streaming text output ---
        if event_type in ("response.output_text.delta", "text_delta"):
            delta_text = data.get("delta", "") or data.get("text", "")
            event = {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": delta_text},
            }
            filtered = _filter_event(event)
            if filtered:
                await self._emit(filtered)
            return

        # --- Tool / function call ---
        if event_type in ("response.output_item.added", "function_call", "tool_call"):
            item = data.get("item", data)
            fn_name = item.get("name") or item.get("function", {}).get("name", "")
            args_raw = item.get("arguments") or item.get("function", {}).get("arguments", "{}")
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
            except json.JSONDecodeError:
                args = {"command": args_raw}

            normalized_name = _map_codex_tool(fn_name)
            await self._emit(
                {
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": normalized_name,
                            "input": args,
                        }
                    ],
                }
            )
            return

        # --- Turn complete ---
        if event_type in ("response.completed", "response.done", "done"):
            usage = data.get("usage", {})
            model_id = data.get("model", self._model)
            self._last_result = {
                "type": "result",
                "stop_reason": "end_turn",
                "modelUsage": {
                    model_id: {
                        "inputTokens": usage.get("input_tokens", 0),
                        "outputTokens": usage.get("output_tokens", 0),
                        "cacheReadInputTokens": 0,
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            await self._emit(self._last_result)
            return

        # --- Error ---
        if event_type == "error":
            message = data.get("message", str(data))
            logger.warning("Codex CLI error event: %s", message)
            await self._emit({"type": "error", "content": message})
            return

        # --- Pass unknown events through (forward to browser for inspection) ---
        logger.debug("Codex: unknown event type=%s, forwarding as-is", event_type)
        await self._emit(data)

    def _make_synthetic_result(self, exit_code: int) -> dict:
        """Build a synthetic result event when Codex exits without emitting one."""
        stop_reason = "end_turn" if exit_code == 0 else "error"
        return {
            "type": "result",
            "stop_reason": stop_reason,
            "modelUsage": {
                self._model: {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheReadInputTokens": 0,
                    "cacheCreationInputTokens": 0,
                }
            },
        }

    @property
    def session_id(self) -> str | None:
        # Codex CLI does not expose a resumable session ID
        return None

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None
