"""CodexWebSocketTransport — Codex app-server over WebSocket (JSON-RPC 2.0).

Spawns ``codex app-server --listen ws://127.0.0.1:{port}`` and connects to it
as a WebSocket client.  Communication uses JSON-RPC 2.0 (requests, responses,
notifications) rather than the NDJSON protocol used by Claude's ``--sdk-url``.

The direction is reversed compared to SdkWebSocketTransport: here Skuld is the
*client* connecting to the Codex app-server, whereas with Claude the CLI
connects back to Skuld.
"""

import asyncio
import json
import logging
import os
from itertools import count

import websockets
from websockets.asyncio.client import ClientConnection

from skuld.transports import (
    CLITransport,
    TransportCapabilities,
    _drain_stream,
    _filter_event,
    _stop_process,
)
from skuld.transports.codex import _map_codex_tool

logger = logging.getLogger("skuld.transport")

# Monotonic request-ID generator for JSON-RPC calls.
_next_id = count(1)


def _rpc_request(method: str, params: dict | None = None) -> tuple[int, dict]:
    """Build a JSON-RPC 2.0 request and return (id, message)."""
    rid = next(_next_id)
    msg: dict = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        msg["params"] = params
    return rid, msg


def _rpc_notification(method: str) -> dict:
    """Build a JSON-RPC 2.0 notification (no id, no response expected)."""
    return {"jsonrpc": "2.0", "method": method}


class CodexWebSocketTransport(CLITransport):
    """Long-lived Codex app-server process controlled via WebSocket JSON-RPC.

    Lifecycle:
        1. ``start()`` spawns ``codex app-server --listen ws://127.0.0.1:{port}``
        2. Skuld connects to the server as a WebSocket client
        3. JSON-RPC ``initialize`` handshake, then ``thread/start``
        4. User messages are sent via ``turn/start``
        5. Streaming events arrive as JSON-RPC notifications

    Authentication: set ``OPENAI_API_KEY`` in the environment.
    """

    def __init__(
        self,
        workspace_dir: str,
        *,
        model: str = "o4-mini",
        skip_permissions: bool = True,
        system_prompt: str = "",
        initial_prompt: str = "",
        codex_port: int = 0,
        **_kwargs: object,
    ) -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self._model = model
        self._skip_permissions = skip_permissions
        self._system_prompt = system_prompt
        self._initial_prompt = initial_prompt
        self._codex_port = codex_port or _pick_free_port()

        self._process: asyncio.subprocess.Process | None = None
        self._ws: ClientConnection | None = None
        self._receive_task: asyncio.Task | None = None
        self._thread_id: str | None = None
        self._current_turn_id: str | None = None
        self._last_result: dict | None = None
        self._alive = False

        # Pending RPC response futures keyed by request id.
        self._pending: dict[int, asyncio.Future] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        await self._spawn_app_server()
        await self._connect_ws()
        await self._handshake()

        if self._initial_prompt:
            await self.send_message(self._initial_prompt)

    async def stop(self) -> None:
        self._alive = False

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()

        if self._ws:
            try:
                await self._ws.close()
            except Exception as exc:
                logger.debug("Error closing Codex WS: %r", exc)
            self._ws = None

        if self._process:
            await _stop_process(self._process)
            self._process = None

        # Cancel any awaiting RPC futures.
        for fut in self._pending.values():
            if not fut.done():
                fut.cancel()
        self._pending.clear()

        logger.info("CodexWebSocketTransport stopped")

    # ------------------------------------------------------------------
    # Spawn & connect
    # ------------------------------------------------------------------

    async def _spawn_app_server(self) -> None:
        listen_url = f"ws://127.0.0.1:{self._codex_port}"

        cmd = [
            "codex",
            "app-server",
            "--listen",
            listen_url,
        ]

        env = dict(os.environ)
        if "OPENAI_API_KEY" not in env:
            logger.warning("OPENAI_API_KEY not found — Codex app-server may fail to authenticate")

        logger.info("Spawning Codex app-server on %s", listen_url)
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        logger.info("Codex app-server PID %s", self._process.pid)

        asyncio.create_task(_drain_stream(self._process.stdout, "codex-app-stdout"))
        asyncio.create_task(_drain_stream(self._process.stderr, "codex-app-stderr"))

    async def _connect_ws(self) -> None:
        """Connect to the Codex app-server with retries."""
        url = f"ws://127.0.0.1:{self._codex_port}"
        max_attempts = 30
        for attempt in range(1, max_attempts + 1):
            if self._process and self._process.returncode is not None:
                raise RuntimeError(f"Codex app-server exited with code {self._process.returncode}")
            try:
                self._ws = await websockets.connect(url)
                logger.info("Connected to Codex app-server (attempt %d)", attempt)
                self._alive = True
                self._receive_task = asyncio.create_task(self._receive_loop())
                return
            except (OSError, websockets.exceptions.InvalidHandshake):
                if attempt == max_attempts:
                    raise RuntimeError(
                        f"Could not connect to Codex app-server at {url} "
                        f"after {max_attempts} attempts"
                    )
                await asyncio.sleep(0.5)

    # ------------------------------------------------------------------
    # JSON-RPC helpers
    # ------------------------------------------------------------------

    async def _send_rpc(self, method: str, params: dict | None = None) -> dict:
        """Send a JSON-RPC request and wait for the response."""
        if not self._ws:
            raise RuntimeError("WebSocket not connected")

        rid, msg = _rpc_request(method, params)
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[dict] = loop.create_future()
        self._pending[rid] = fut

        await self._ws.send(json.dumps(msg))
        logger.debug("RPC → %s id=%d", method, rid)

        try:
            return await asyncio.wait_for(fut, timeout=60.0)
        except TimeoutError:
            self._pending.pop(rid, None)
            raise RuntimeError(f"RPC timeout for {method} (id={rid})")

    async def _send_notification(self, method: str) -> None:
        """Send a JSON-RPC notification (fire-and-forget)."""
        if not self._ws:
            return
        await self._ws.send(json.dumps(_rpc_notification(method)))

    # ------------------------------------------------------------------
    # Handshake
    # ------------------------------------------------------------------

    async def _handshake(self) -> None:
        """Perform initialize + initialized + thread/start."""
        result = await self._send_rpc(
            "initialize",
            {
                "clientInfo": {"name": "skuld", "version": "1.0.0"},
                "capabilities": {"experimentalApi": False},
            },
        )
        logger.info("Codex initialize response: %s", result)

        await self._send_notification("initialized")

        thread_params: dict = {
            "experimentalRawEvents": False,
            "persistExtendedHistory": True,
            "cwd": self.workspace_dir,
        }
        if self._model:
            thread_params["model"] = self._model
        if self._skip_permissions:
            thread_params["approvalPolicy"] = "never"
            thread_params["sandbox"] = "danger-full-access"
        if self._system_prompt:
            thread_params["developerInstructions"] = self._system_prompt

        result = await self._send_rpc("thread/start", thread_params)
        # The response triggers a thread/started notification with the thread info.
        # But the RPC response itself may contain the thread_id.
        thread = result.get("thread", {})
        self._thread_id = thread.get("id") or result.get("threadId")
        logger.info("Codex thread started: %s", self._thread_id)

        # Emit a synthetic init event so the broker knows we're ready.
        await self._emit(
            {
                "type": "system",
                "subtype": "init",
                "session_id": self._thread_id,
                "model": self._model,
                "tools": [],
            }
        )

    # ------------------------------------------------------------------
    # Receive loop
    # ------------------------------------------------------------------

    async def _receive_loop(self) -> None:
        """Read JSON-RPC messages from the Codex WebSocket."""
        logger.info("Codex WS receive loop started")
        msg_count = 0
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Non-JSON from Codex WS: %.200s", raw)
                    continue

                msg_count += 1

                # JSON-RPC response (has "id" + "result" or "error")
                if "id" in data and ("result" in data or "error" in data):
                    self._resolve_pending(data)
                    continue

                # JSON-RPC notification or server request (has "method")
                if "method" in data:
                    await self._handle_server_message(data)
                    continue

                logger.debug("Codex WS unknown frame: %.200s", raw)

        except websockets.exceptions.ConnectionClosed as exc:
            logger.info("Codex WS closed: %s", exc)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("Codex WS receive error: %r", exc, exc_info=True)
        finally:
            self._alive = False
            logger.info("Codex WS receive loop ended after %d messages", msg_count)

    def _resolve_pending(self, data: dict) -> None:
        """Match a JSON-RPC response to its pending future."""
        rid = data.get("id")
        fut = self._pending.pop(rid, None)
        if not fut or fut.done():
            return

        if "error" in data:
            err = data["error"]
            fut.set_exception(RuntimeError(f"RPC error {err.get('code')}: {err.get('message')}"))
            return

        fut.set_result(data.get("result", {}))

    # ------------------------------------------------------------------
    # Server message dispatch
    # ------------------------------------------------------------------

    async def _handle_server_message(self, data: dict) -> None:
        """Dispatch a JSON-RPC notification or server-request from Codex."""
        method = data.get("method", "")
        params = data.get("params", {})
        logger.debug("Codex notification: %s", method)

        # --- Server requests (need a response) ---
        if "id" in data:
            await self._handle_server_request(data)
            return

        # --- Notifications ---
        if method == "item/agentMessage/delta":
            await self._emit_text_delta(params.get("delta", ""))
            return

        if method == "item/reasoning/textDelta":
            delta = params.get("delta", "")
            if delta:
                event = {
                    "type": "content_block_delta",
                    "delta": {"type": "thinking_delta", "thinking": delta},
                }
                await self._emit(event)
            return

        if method == "item/reasoning/summaryTextDelta":
            delta = params.get("delta", "")
            if delta:
                event = {
                    "type": "content_block_delta",
                    "delta": {"type": "thinking_delta", "thinking": delta},
                }
                await self._emit(event)
            return

        if method == "turn/started":
            turn = params.get("turn", {})
            self._current_turn_id = turn.get("id")
            return

        if method == "turn/completed":
            self._current_turn_id = None
            # Emit a result event
            self._last_result = {
                "type": "result",
                "stop_reason": "end_turn",
                "modelUsage": {},
            }
            await self._emit(self._last_result)
            return

        if method == "thread/tokenUsage/updated":
            usage = params.get("tokenUsage", {})
            total = usage.get("total", {})
            model_id = self._model
            self._last_result = {
                "type": "result",
                "stop_reason": "end_turn",
                "modelUsage": {
                    model_id: {
                        "inputTokens": total.get("inputTokens", 0),
                        "outputTokens": total.get("outputTokens", 0),
                        "cacheReadInputTokens": total.get("cachedInputTokens", 0),
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            return

        if method == "item/started":
            item = params.get("item", {})
            await self._handle_item_started(item)
            return

        if method == "item/completed":
            item = params.get("item", {})
            await self._handle_item_completed(item)
            return

        if method == "item/commandExecution/outputDelta":
            delta = params.get("delta", "")
            if delta:
                await self._emit_text_delta(delta)
            return

        if method == "item/fileChange/outputDelta":
            delta = params.get("delta", "")
            if delta:
                await self._emit_text_delta(delta)
            return

        if method == "error":
            error = params.get("error", {})
            message = error.get("message", str(params))
            logger.warning("Codex error notification: %s", message)
            await self._emit({"type": "error", "content": message})
            return

        if method == "thread/started":
            thread = params.get("thread", {})
            tid = thread.get("id")
            if tid:
                self._thread_id = tid
            return

        if method == "thread/status/changed":
            return  # Informational, no action needed

        if method == "thread/name/updated":
            return  # Informational

        if method == "thread/closed":
            self._alive = False
            return

        logger.debug("Codex: unhandled notification %s", method)

    # ------------------------------------------------------------------
    # Server requests (approval callbacks)
    # ------------------------------------------------------------------

    async def _handle_server_request(self, data: dict) -> None:
        """Handle a server-initiated request that needs a response."""
        method = data.get("method", "")
        rid = data["id"]
        params = data.get("params", {})

        if method == "item/commandExecution/requestApproval":
            # Emit as permission request to browser
            request_id = str(rid)
            command = params.get("command", "")
            await self._emit(
                {
                    "type": "control_request",
                    "subtype": "can_use_tool",
                    "request_id": request_id,
                    "tool": "Bash",
                    "input": {"command": command},
                }
            )
            # Store the RPC id so send_control_response can reply
            self._pending_approvals: dict[str, int] = getattr(self, "_pending_approvals", {})
            self._pending_approvals[request_id] = rid
            return

        if method in (
            "item/fileChange/requestApproval",
            "item/permissions/requestApproval",
            "applyPatchApproval",
        ):
            request_id = str(rid)
            await self._emit(
                {
                    "type": "control_request",
                    "subtype": "can_use_tool",
                    "request_id": request_id,
                    "tool": "Edit",
                    "input": params,
                }
            )
            self._pending_approvals = getattr(self, "_pending_approvals", {})
            self._pending_approvals[request_id] = rid
            return

        # Default: auto-approve unknown requests
        logger.debug("Auto-approving Codex server request: %s", method)
        await self._send_rpc_response(rid, {"decision": "allow"})

    async def _send_rpc_response(self, rid: int, result: dict) -> None:
        """Send a JSON-RPC response for a server-initiated request."""
        if not self._ws:
            return
        msg = {"jsonrpc": "2.0", "id": rid, "result": result}
        await self._ws.send(json.dumps(msg))

    # ------------------------------------------------------------------
    # Item handling (tool calls)
    # ------------------------------------------------------------------

    async def _handle_item_started(self, item: dict) -> None:
        """Emit a tool_use event when an item starts."""
        item_type = item.get("type", "")

        if item_type == "commandExecution":
            await self._emit(
                {
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "Bash",
                            "input": {"command": item.get("command", "")},
                        }
                    ],
                }
            )
            return

        if item_type == "fileChange":
            changes = item.get("changes", [])
            await self._emit(
                {
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "Edit",
                            "input": {"changes": changes},
                        }
                    ],
                }
            )
            return

        if item_type == "mcpToolCall":
            tool = item.get("tool", "")
            args = item.get("arguments", {})
            normalized = _map_codex_tool(tool)
            await self._emit(
                {
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": normalized,
                            "input": args if isinstance(args, dict) else {},
                        }
                    ],
                }
            )
            return

        if item_type == "agentMessage":
            # Start of agent text — nothing to emit yet, deltas follow
            return

        if item_type == "reasoning":
            return

        if item_type == "webSearch":
            await self._emit(
                {
                    "type": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "WebSearch",
                            "input": {"query": item.get("query", "")},
                        }
                    ],
                }
            )
            return

    async def _handle_item_completed(self, item: dict) -> None:
        """Emit tool result events when an item completes."""
        item_type = item.get("type", "")

        if item_type == "commandExecution":
            output = item.get("aggregatedOutput", "")
            exit_code = item.get("exitCode", 0)
            await self._emit(
                {
                    "type": "tool_result",
                    "content": output,
                    "is_error": exit_code != 0,
                }
            )
            return

        if item_type == "agentMessage":
            text = item.get("text", "")
            if text:
                await self._emit_text_delta(text)
            return

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _emit_text_delta(self, text: str) -> None:
        """Emit a text delta event, filtering empties."""
        if not text:
            return
        event = {
            "type": "content_block_delta",
            "delta": {"type": "text_delta", "text": text},
        }
        filtered = _filter_event(event)
        if filtered:
            await self._emit(filtered)

    # ------------------------------------------------------------------
    # CLITransport interface
    # ------------------------------------------------------------------

    async def send_message(self, content: str) -> None:
        if not self._thread_id:
            raise RuntimeError("No active thread — call start() first")

        self._last_result = None
        params: dict = {
            "threadId": self._thread_id,
            "input": [{"type": "text", "text": content, "text_elements": []}],
        }
        if self._model:
            params["model"] = self._model

        logger.info("Sending turn/start to Codex (thread=%s)", self._thread_id)
        await self._send_rpc("turn/start", params)

    async def send_control_response(self, request_id: str, response: dict) -> None:
        """Respond to a Codex approval request."""
        approvals: dict[str, int] = getattr(self, "_pending_approvals", {})
        rid = approvals.pop(request_id, None)
        if rid is None:
            logger.warning("No pending approval for request_id=%s", request_id)
            return

        # Map broker permission response to Codex approval decision
        behavior = response.get("behavior", "allow")
        decision = "allow" if behavior == "allow" else "deny"
        await self._send_rpc_response(rid, {"decision": decision})

    async def send_control(self, subtype: str, **kwargs: object) -> None:
        """Handle control messages (interrupt, set_model, etc.)."""
        if subtype == "interrupt":
            if self._thread_id and self._current_turn_id:
                await self._send_rpc(
                    "turn/interrupt",
                    {
                        "threadId": self._thread_id,
                        "turnId": self._current_turn_id,
                    },
                )
            return

        if subtype == "set_model":
            model = kwargs.get("model")
            if model and isinstance(model, str):
                self._model = model
            return

        logger.debug("Codex WS: unhandled control subtype=%s", subtype)

    @property
    def session_id(self) -> str | None:
        return self._thread_id

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return self._alive

    @property
    def capabilities(self) -> TransportCapabilities:
        return TransportCapabilities(
            cli_websocket=False,  # We don't expose a /ws/cli endpoint
            session_resume=True,
            interrupt=True,
            set_model=True,
            set_thinking_tokens=False,
            set_permission_mode=False,
            rewind_files=False,
            mcp_set_servers=False,
            permission_requests=True,
        )

    # ------------------------------------------------------------------
    # Session resume
    # ------------------------------------------------------------------

    async def resume(self, thread_id: str) -> None:
        """Resume a previous Codex thread."""
        params: dict = {
            "threadId": thread_id,
            "persistExtendedHistory": True,
        }
        if self._model:
            params["model"] = self._model
        if self._skip_permissions:
            params["approvalPolicy"] = "never"
            params["sandbox"] = "danger-full-access"

        result = await self._send_rpc("thread/resume", params)
        thread = result.get("thread", {})
        self._thread_id = thread.get("id") or thread_id
        logger.info("Codex thread resumed: %s", self._thread_id)

        await self._emit(
            {
                "type": "system",
                "subtype": "init",
                "session_id": self._thread_id,
                "model": self._model,
                "tools": [],
            }
        )


def _pick_free_port() -> int:
    """Pick an available TCP port."""
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
