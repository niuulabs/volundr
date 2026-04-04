"""Skuld Broker - WebSocket proxy for Claude Code CLI.

Supports two transport modes (selected via config):
- "sdk": long-lived CLI process connected via --sdk-url WebSocket (default)
- "subprocess": spawns claude -p per message, reads stdout (legacy fallback)
"""

import asyncio
import base64
import collections
import json
import logging
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from niuu.domain.logging import LoggingConfig
from skuld.channels import (
    ChannelRegistry,
    TelegramChannel,
    WebSocketChannel,
)
from skuld.chronicle_watcher import ChronicleWatcher
from skuld.config import SkuldSettings
from skuld.service_manager import (
    ServiceCreateRequest,
    ServiceManager,
    ServiceStatus,
)
from skuld.transport import (
    CLITransport,
    CodexSubprocessTransport,
    SdkWebSocketTransport,
    SubprocessTransport,
)

# ---------------------------------------------------------------------------
# In-memory log buffer (Part 2: Pod Log Retrieval)
# ---------------------------------------------------------------------------

_log_buffer: collections.deque[dict] = collections.deque(maxlen=2000)


class _BufferHandler(logging.Handler):
    """Logging handler that appends structured records to an in-memory ring buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        _log_buffer.append(
            {
                "time": self.format(record) if not hasattr(record, "asctime") else "",
                "timestamp": record.created,
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            }
        )


def _configure_logging() -> None:
    """Configure logging from LoggingConfig (reads LOG_LEVEL, LOG_FORMAT env vars)."""
    config = LoggingConfig()
    level_name = config.level.upper()
    log_format = config.format.lower()

    level = getattr(logging, level_name, logging.INFO)

    if log_format == "json":
        fmt = (
            '{"time":"%(asctime)s","level":"%(levelname)s",'
            '"logger":"%(name)s","message":"%(message)s"}'
        )
    else:
        fmt = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    logging.basicConfig(level=level, format=fmt)

    # Attach ring buffer handler to root logger so all loggers feed into it
    buffer_handler = _BufferHandler()
    buffer_handler.setLevel(level)
    logging.getLogger().addHandler(buffer_handler)


_configure_logging()
logger = logging.getLogger("skuld.broker")


# ---------------------------------------------------------------------------
# Session artifacts & summary prompt (Part: Chronicle Summary Generation)
# ---------------------------------------------------------------------------

_GIT_COMMIT_PREFIXES = ("git commit", "git -c ", "git -C ")

# Matches git commit output like: [main e4f7a21] fix: some message
_GIT_COMMIT_OUTPUT_RE = re.compile(r"\[[\w/-]+\s+([a-f0-9]{7,})\]\s+(.+)")


def _is_git_commit(cmd: str) -> bool:
    """Return True if a Bash command is a git commit invocation."""
    stripped = cmd.lstrip()
    if stripped.startswith(_GIT_COMMIT_PREFIXES):
        return True
    # Handle chained commands: git add . && git commit -m "..."
    return "git commit" in stripped


def _extract_git_commit_info(output: str) -> tuple[str, str] | None:
    """Extract commit hash and message from git commit output.

    Returns (hash, message) tuple or None if not found.
    """
    match = _GIT_COMMIT_OUTPUT_RE.search(output)
    if not match:
        return None
    return match.group(1), match.group(2)


@dataclass
class SessionArtifacts:
    """In-memory accumulator for session activity during the broker's lifetime.

    Populated passively from events flowing through ``_handle_cli_event``.
    """

    files_changed: list[str] = field(default_factory=list)
    turn_count: int = 0
    started_at: float = field(default_factory=time.monotonic)
    _known_files: set[str] = field(default_factory=set)
    _pending_tool_results: dict[str, dict] = field(default_factory=dict)

    @property
    def duration_seconds(self) -> int:
        return int(time.monotonic() - self.started_at)

    def _classify_tool(self, tool_name: str, tool_input: dict) -> dict | None:
        """Classify a single tool_use block into a timeline event dict.

        Returns None when the tool doesn't map to a timeline event.
        """
        file_path = tool_input.get("file_path") or tool_input.get("path")

        if tool_name in ("Edit", "Write", "NotebookEdit"):
            if tool_name == "Edit":
                # Edit always modifies an existing file
                action = "modified"
                if file_path:
                    self._known_files.add(file_path)
            elif file_path and file_path in self._known_files:
                action = "modified"
            elif file_path:
                action = "created"
                self._known_files.add(file_path)
            else:
                action = "created"
            return {"type": "file", "label": file_path or tool_name, "action": action}

        if tool_name == "Read":
            # Track files we've seen for created/modified classification
            if file_path:
                self._known_files.add(file_path)
            return None

        if tool_name != "Bash":
            return None

        cmd = tool_input.get("command", "")
        if _is_git_commit(cmd):
            # Store pending; will be enriched by tool_result
            return {"type": "git", "label": cmd[:80] or "git commit", "_pending_git": True}

        return {"type": "terminal", "label": cmd[:80] or "bash"}

    def record_tool_use(self, data: dict) -> list[dict]:
        """Extract file paths from tool_use events (Write, Edit, etc.).

        Returns a list of timeline-reportable tool events extracted
        from the content blocks.
        """
        tool_events: list[dict] = []
        content = data.get("content", [])
        if not isinstance(content, list):
            return tool_events

        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue

            tool_name = block.get("name", "")
            tool_input = block.get("input", {})
            tool_use_id = block.get("id", "")
            file_path = tool_input.get("file_path") or tool_input.get("path")

            if file_path and file_path not in self.files_changed:
                self.files_changed.append(file_path)

            event = self._classify_tool(tool_name, tool_input)
            if event:
                # Store tool_use_id for matching with tool_result
                if tool_use_id:
                    event["_tool_use_id"] = tool_use_id
                tool_events.append(event)

        return tool_events

    def enrich_from_tool_result(self, data: dict, tool_events: list[dict]) -> None:
        """Enrich pending tool events with data from tool_result blocks.

        Extracts exit codes for terminal events and commit info for git events
        from the corresponding tool_result content blocks.
        """
        content = data.get("content", [])
        if not isinstance(content, list):
            return

        # Build a map of tool_result blocks by tool_use_id
        result_map: dict[str, dict] = {}
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_result":
                continue
            use_id = block.get("tool_use_id", "")
            if use_id:
                result_map[use_id] = block

        for event in tool_events:
            use_id = event.pop("_tool_use_id", "")
            if not use_id or use_id not in result_map:
                continue

            result_block = result_map[use_id]
            result_content = result_block.get("content", "")
            if isinstance(result_content, list):
                # Extract text from content blocks
                result_content = " ".join(
                    b.get("text", "") for b in result_content if isinstance(b, dict)
                )

            if event.get("type") == "git" and event.pop("_pending_git", False):
                commit_info = _extract_git_commit_info(result_content)
                if commit_info:
                    event["hash"] = commit_info[0]
                    event["label"] = commit_info[1]

            if event.get("type") == "terminal":
                # Extract exit code — look for explicit exit code in result
                exit_code = self._extract_exit_code(result_block)
                if exit_code is not None:
                    event["exit"] = exit_code

    @staticmethod
    def _extract_exit_code(result_block: dict) -> int | None:
        """Extract exit code from a tool_result block.

        The SDK transport includes exit code info in the result block.
        """
        # Check for explicit exit_code field
        if "exit_code" in result_block:
            return result_block["exit_code"]

        # Check content for exit code pattern
        content = result_block.get("content", "")
        if isinstance(content, str):
            # Check for error indicator — if tool_result has is_error
            if result_block.get("is_error"):
                return 1
            return 0

        # For list content, check is_error flag
        if result_block.get("is_error"):
            return 1
        return 0

    def record_result(self) -> None:
        """Increment turn counter on each result event."""
        self.turn_count += 1


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

_AUTH_HEADER = "authorization"
_BEARER_PREFIX = "bearer "


def _decode_jwt_claims(token: str) -> dict:
    """Decode JWT payload without signature verification.

    Skuld does not verify signatures — that is Envoy's / the API gateway's
    job.  We only decode to extract user identity claims for API forwarding.
    """
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        # JWT base64url → standard base64
        payload_b64 = parts[1]
        # Add padding
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        return json.loads(payload_bytes)
    except Exception:
        return {}


def _extract_bearer_token(headers: dict[str, str]) -> str | None:
    """Extract Bearer token from an Authorization header value."""
    auth = headers.get(_AUTH_HEADER, "")
    if auth.lower().startswith(_BEARER_PREFIX):
        return auth[len(_BEARER_PREFIX) :].strip()
    return None


def _extract_token_from_websocket(websocket: WebSocket) -> str | None:
    """Extract JWT from WebSocket connection.

    Checks (in order):
    1. Authorization header (Bearer token) — preferred, works with Envoy
    2. x-auth-* headers injected by Envoy sidecar
    3. access_token query parameter — browser fallback
    """
    headers = {k.lower(): v for k, v in websocket.headers.items()}

    # 1. Bearer token from Authorization header
    token = _extract_bearer_token(headers)
    if token:
        return token

    # 2. If Envoy x-auth-* headers are present, we don't have the raw JWT
    #    but we have the validated claims — return None (caller uses headers).

    # 3. Query parameter fallback (browser WebSocket can't set headers)
    return websocket.query_params.get("access_token")


CONVERSATION_HISTORY_DIR = ".skuld"
CONVERSATION_HISTORY_FILE = "conversation.json"


@dataclass
class ConversationTurn:
    """A single turn in the conversation history."""

    id: str
    role: str  # "user" | "assistant"
    content: str
    parts: list[dict] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    metadata: dict = field(default_factory=dict)


CHRONICLE_SUMMARY_PROMPT = """\
Summarize this coding session in JSON format. Be concise.
Respond ONLY with the JSON object, no markdown fencing, no commentary.

{
  "summary": "One paragraph describing what was accomplished in this session.",
  "key_changes": ["file_or_component: brief description of change", ...],
  "unfinished_work": "Description of anything left incomplete, or null if done."
}
"""

SUMMARY_TIMEOUT_SECONDS = 15


class Broker:
    """WebSocket broker for Claude Code sessions.

    Transport-agnostic: delegates CLI communication to a CLITransport
    implementation selected by configuration.
    """

    def __init__(self, settings: SkuldSettings | None = None):
        self._settings = settings or SkuldSettings()
        self.session_id = self._settings.session.id
        self.model = self._settings.session.model
        self.workspace_dir = self._settings.workspace_path
        self.volundr_api_url = self._settings.volundr_api_url
        self._transport: CLITransport | None = None
        self.service_manager: ServiceManager | None = None
        self._channels = ChannelRegistry()
        self._http_client: httpx.AsyncClient | None = None
        self._http_client_jwt: str | None = None  # JWT used to create _http_client
        self._artifacts = SessionArtifacts()
        self._session_start_reported = False
        self._event_sequence = 0
        self._activity_state: str = "idle"
        self._last_activity_report: float = 0.0
        self._conversation_turns: list[ConversationTurn] = []
        self._pending_assistant_content: str = ""
        self._pending_assistant_parts: list[dict] = []
        self._pending_block_type: str = ""
        self._pending_reasoning_text: str = ""
        self._chronicle_watcher: ChronicleWatcher | None = None

        # JWT identity state — populated on first browser WebSocket connection
        self._user_jwt: str | None = None
        self._user_claims: dict = {}

    def _conversation_history_path(self) -> Path:
        """Return the path to the conversation history file, scoped to session ID."""
        filename = f"conversation_{self.session_id}.json"
        return Path(self.workspace_dir) / CONVERSATION_HISTORY_DIR / filename

    def _load_conversation_history(self) -> None:
        """Load conversation history from disk if it exists."""
        path = self._conversation_history_path()
        if not path.exists():
            return

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            turns = data.get("turns", [])
            self._conversation_turns = [
                ConversationTurn(
                    id=t.get("id", str(uuid.uuid4())),
                    role=t.get("role", "user"),
                    content=t.get("content", ""),
                    parts=t.get("parts", []),
                    created_at=t.get("created_at", ""),
                    metadata=t.get("metadata", {}),
                )
                for t in turns
            ]
            logger.info(
                "Loaded %d conversation turns from %s",
                len(self._conversation_turns),
                path,
            )
        except Exception:
            logger.warning("Failed to load conversation history from %s", path, exc_info=True)

    def _save_conversation_history(self) -> None:
        """Persist conversation history to disk."""
        path = self._conversation_history_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = {"turns": [asdict(t) for t in self._conversation_turns]}
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception:
            logger.warning("Failed to save conversation history to %s", path, exc_info=True)

    def _append_turn(self, turn: ConversationTurn) -> None:
        """Append a turn and persist to disk."""
        self._conversation_turns.append(turn)
        self._save_conversation_history()

    def _flush_pending_assistant_turn(self, metadata: dict | None = None) -> None:
        """Save any accumulated assistant content as a conversation turn."""
        content = self._pending_assistant_content
        if not content:
            return

        # Flush remaining reasoning
        if self._pending_reasoning_text:
            summary = self._pending_reasoning_text[-500:]
            self._pending_assistant_parts.append({"type": "reasoning", "text": summary})

        parts = self._pending_assistant_parts if self._pending_assistant_parts else []
        self._append_turn(
            ConversationTurn(
                id=str(uuid.uuid4()),
                role="assistant",
                content=content,
                parts=parts,
                metadata=metadata or {},
            )
        )
        self._pending_assistant_content = ""
        self._pending_assistant_parts = []
        self._pending_reasoning_text = ""

    def _create_transport(self) -> CLITransport:
        """Create the configured CLI transport.

        Dispatch order:
        1. cli_type selects the CLI backend ("claude" or "codex")
        2. For Claude, transport selects the protocol ("sdk" or "subprocess")
        """
        match self._settings.cli_type:
            case "codex":
                logger.info("Using CodexSubprocessTransport (model: %s)", self.model)
                return CodexSubprocessTransport(
                    workspace_dir=self.workspace_dir,
                    model=self.model,
                )
            case _:
                # Default: Claude Code
                match self._settings.transport:
                    case "subprocess":
                        logger.info("Using SubprocessTransport (Claude legacy)")
                        return SubprocessTransport(self.workspace_dir)
                    case _:
                        logger.info("Using SdkWebSocketTransport (Claude SDK)")
                        return SdkWebSocketTransport(
                            workspace_dir=self.workspace_dir,
                            sdk_port=self._settings.port,
                            session_id=self.session_id,
                            model=self.model,
                            skip_permissions=self._settings.skip_permissions,
                            agent_teams=self._settings.agent_teams,
                            system_prompt=self._settings.session.system_prompt,
                            initial_prompt=self._settings.session.initial_prompt,
                        )

    async def startup(self) -> None:
        """Initialize the broker on startup."""
        logger.info("Broker starting for session %s", self.session_id)
        logger.info("Transport: %s", self._settings.transport)

        if self.volundr_api_url:
            logger.info("Token usage reporting enabled: %s", self.volundr_api_url)
        else:
            logger.warning("VOLUNDR_API_URL not set — token usage will not be reported")

        # Ensure workspace directory exists
        os.makedirs(self.workspace_dir, exist_ok=True)

        # Load conversation history from disk
        self._load_conversation_history()

        # Initialize transport
        self._transport = self._create_transport()
        self._transport.on_event(self._handle_cli_event)

        # Initialize service manager
        self.service_manager = ServiceManager(self.workspace_dir)
        await self.service_manager.init()
        logger.info("Service manager initialized")

        # Initialize Telegram channel if configured
        await self._init_telegram_channel()

        # Start chronicle watcher (tails JSONL session files for terminal mode)
        if self._settings.chronicle_watcher_enabled and self.volundr_api_url:
            workspace_slug = self.workspace_dir.replace("/", "-")
            watch_dir = Path.home() / ".claude" / "projects" / workspace_slug
            self._chronicle_watcher = ChronicleWatcher(
                session_id=self.session_id,
                watch_dir=watch_dir,
                api_base_url=self.volundr_api_url,
                http_headers=self._build_auth_headers(),
                debounce_ms=self._settings.chronicle_watcher_debounce_ms,
            )
            asyncio.create_task(self._chronicle_watcher.start())
            logger.info("Chronicle watcher started for %s", watch_dir)

        # Auto-start transport when an initial prompt is configured
        # (dispatched sessions should begin work immediately, not wait
        # for a browser to connect).
        if self._settings.session.initial_prompt:
            logger.info("Initial prompt configured — auto-starting transport")
            try:
                await self._transport.start()
                logger.info("Transport auto-started successfully")
            except Exception as e:
                logger.error("Transport auto-start failed: %r", e, exc_info=True)

    async def shutdown(self) -> None:
        """Clean up on shutdown.

        Reports chronicle summary to Volundr API before stopping the
        transport, so the CLI process is still alive for summary generation.
        """
        logger.info("Broker shutting down")

        # Stop chronicle watcher first (flush pending events)
        if self._chronicle_watcher:
            await self._chronicle_watcher.stop()

        # Report chronicle BEFORE stopping the transport (CLI must be alive)
        await self._report_chronicle()

        # Close all message channels (browser WebSockets, Telegram, etc.)
        await self._channels.close_all()

        # Stop transport
        if self._transport:
            await self._transport.stop()

        # Close HTTP client
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    async def _handle_cli_event(self, data: dict) -> None:
        """Forward a CLI event to all connected channels."""
        event_type = data.get("type", "unknown")
        num_channels = self._channels.count
        logger.debug(
            "_handle_cli_event: type=%s, forwarding to %d channel(s)",
            event_type,
            num_channels,
        )

        if num_channels == 0:
            logger.warning(
                "_handle_cli_event: no channels to forward type=%s",
                event_type,
            )

        await self._channels.broadcast(data)

        # Record user messages that arrive via the transport (e.g. the
        # initial prompt flushed as a pending message) into conversation
        # history so late-joining browsers see them.
        if event_type == "user":
            # A user event means the previous assistant turn is complete.
            # Flush any pending assistant content as a saved turn.
            self._flush_pending_assistant_turn()

            user_content = ""
            msg = data.get("message", {})
            if isinstance(msg, dict):
                user_content = msg.get("content", "")
            if isinstance(user_content, str) and user_content:
                self._append_turn(
                    ConversationTurn(
                        id=str(uuid.uuid4()),
                        role="user",
                        content=user_content,
                    )
                )

        # When CLI sends system/init, broadcast available commands to browsers
        if event_type == "system" and data.get("subtype") == "init":
            slash_commands = data.get("slash_commands", [])
            skills = data.get("skills", [])
            if slash_commands or skills:
                await self._channels.broadcast(
                    {
                        "type": "available_commands",
                        "slash_commands": slash_commands,
                        "skills": skills,
                    }
                )

        # Report activity state transitions to Volundr
        if event_type == "assistant":
            asyncio.create_task(self._report_activity_state("active"))
        elif event_type == "result":
            asyncio.create_task(self._report_activity_state("idle"))

        # Track conversation from assistant messages.
        # The SDK WebSocket protocol sends complete messages as type=assistant
        # with content blocks already resolved (not as streaming deltas).
        # We also handle the HTTP streaming format (content_block_delta, result)
        # for backward compatibility.
        if event_type == "assistant":
            # Extract content from the assistant message
            message = data.get("message", {})
            content_blocks = message.get("content", [])
            if isinstance(content_blocks, list) and content_blocks:
                text_parts = []
                reasoning_parts = []
                for block in content_blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and block.get("text"):
                        text_parts.append(block["text"])
                    elif block.get("type") == "thinking" and block.get("thinking"):
                        reasoning_parts.append(block["thinking"])
                text_content = "\n".join(text_parts)
                if text_content:
                    self._pending_assistant_content = text_content
                    self._pending_assistant_parts = []
                    if reasoning_parts:
                        # Keep last 500 chars of reasoning as summary
                        combined = "\n".join(reasoning_parts)
                        self._pending_assistant_parts.append(
                            {"type": "reasoning", "text": combined[-500:]}
                        )
                    self._pending_assistant_parts.append({"type": "text", "text": text_content})

        # HTTP streaming format: accumulate deltas
        if event_type == "content_block_delta":
            delta = data.get("delta", {})
            delta_type = delta.get("type", "")
            if delta_type == "thinking_delta":
                thinking = delta.get("thinking", "")
                if thinking:
                    self._pending_reasoning_text += thinking
            else:
                text = delta.get("text", "")
                if text:
                    self._pending_assistant_content += text

        # Accumulate artifacts from assistant tool_use events
        if event_type == "assistant":
            tool_events = self._artifacts.record_tool_use(data)
            if tool_events:
                asyncio.create_task(self._report_activity_state("tool_executing"))
            # Enrich tool events with tool_result data (exit codes, git info)
            self._artifacts.enrich_from_tool_result(data, tool_events)
            for tool_ev in tool_events:
                # Clean up internal fields before reporting
                tool_ev.pop("_pending_git", None)
                tool_ev["t"] = self._artifacts.duration_seconds
                asyncio.create_task(self._report_timeline_event(tool_ev))

                # Emit to event pipeline
                pipeline_type = self._classify_pipeline_event(tool_ev)
                asyncio.create_task(
                    self._emit_pipeline_event(
                        pipeline_type,
                        tool_ev,
                    )
                )

        # Capture error events
        if event_type == "error":
            error_msg = (
                data.get("error", {}).get("message", "")
                if isinstance(data.get("error"), dict)
                else data.get("content", str(data.get("error", "Unknown error")))
            )
            asyncio.create_task(
                self._report_timeline_event(
                    {
                        "t": self._artifacts.duration_seconds,
                        "type": "error",
                        "label": str(error_msg)[:120] or "Unknown error",
                    }
                )
            )

        # Report usage on result events and track turn count
        if event_type == "result":
            self._artifacts.record_result()
            asyncio.create_task(self._report_usage(data))

            # Flush pending assistant turn (HTTP streaming format sends result)
            if not self._pending_assistant_content:
                # Try to extract from result event itself
                self._pending_assistant_content = data.get("result", "")
                if not self._pending_assistant_content:
                    for block in data.get("content", []):
                        if isinstance(block, dict) and block.get("type") == "text":
                            self._pending_assistant_content = block.get("text", "")
                            break
            # Build metadata from result event
            model_usage_for_turn = data.get("modelUsage", {})
            result_cost = None
            result_model = None
            for model_id, usage in model_usage_for_turn.items():
                result_model = model_id
                if usage.get("costUSD") is not None:
                    result_cost = (result_cost or 0) + usage["costUSD"]

            # Capture content before flush clears it
            content = self._pending_assistant_content or data.get("result", "")
            self._flush_pending_assistant_turn(
                metadata={
                    "usage": model_usage_for_turn,
                    "cost": result_cost,
                    "model": result_model,
                }
            )
            first_line = ""
            if content:
                for line in content.strip().splitlines():
                    stripped = line.strip()
                    if stripped:
                        first_line = stripped[:80]
                        break
            message_label = first_line or f"Turn {self._artifacts.turn_count}"

            # Report message timeline event with total tokens
            model_usage = data.get("modelUsage", {})
            total_tokens = 0
            total_input = 0
            total_output = 0
            result_model = None
            result_cost = None
            for model_id, usage in model_usage.items():
                result_model = model_id
                inp = (
                    usage.get("inputTokens", 0)
                    + usage.get("cacheReadInputTokens", 0)
                    + usage.get("cacheCreationInputTokens", 0)
                )
                out = usage.get("outputTokens", 0)
                total_input += inp
                total_output += out
                total_tokens += inp + out
                if usage.get("costUSD") is not None:
                    result_cost = (result_cost or 0) + usage["costUSD"]

            if total_tokens > 0:
                asyncio.create_task(
                    self._report_timeline_event(
                        {
                            "t": self._artifacts.duration_seconds,
                            "type": "message",
                            "label": message_label,
                            "tokens": total_tokens,
                        }
                    )
                )

                # Emit message_assistant to event pipeline
                asyncio.create_task(
                    self._emit_pipeline_event(
                        "message_assistant",
                        {
                            "content_length": len(content),
                            "content_preview": content[:200],
                            "finish_reason": data.get("stop_reason", "end_turn"),
                            "turn": self._artifacts.turn_count,
                        },
                        tokens_in=total_input,
                        tokens_out=total_output,
                        cost=result_cost,
                        model=result_model,
                    )
                )

                # Emit token_usage to event pipeline
                asyncio.create_task(
                    self._emit_pipeline_event(
                        "token_usage",
                        {
                            "provider": "cloud",
                            "model": result_model or self.model,
                            "tokens_in": total_input,
                            "tokens_out": total_output,
                        },
                        tokens_in=total_input,
                        tokens_out=total_output,
                        cost=result_cost,
                        model=result_model or self.model,
                    )
                )

    # Maps control message types to the TransportCapabilities field that
    # must be True for the control to be forwarded.
    _CONTROL_CAPABILITY_MAP: dict[str, str] = {
        "interrupt": "interrupt",
        "set_model": "set_model",
        "set_max_thinking_tokens": "set_thinking_tokens",
        "set_permission_mode": "set_permission_mode",
        "rewind_files": "rewind_files",
        "mcp_set_servers": "mcp_set_servers",
    }

    async def _dispatch_browser_message(
        self,
        data: dict,
        sender_ws: WebSocket | None = None,
    ) -> None:
        """Route a browser WebSocket message to the appropriate handler."""
        if not self._transport:
            logger.warning("_dispatch_browser_message: transport is None, dropping message")
            return

        msg_type = data.get("type")
        logger.info(
            "_dispatch_browser_message: type=%s, transport_alive=%s",
            msg_type,
            self._transport.is_alive,
        )

        # Guard: reject control messages the transport does not support.
        cap_field = self._CONTROL_CAPABILITY_MAP.get(msg_type or "")
        if cap_field and not getattr(self._transport.capabilities, cap_field):
            error_msg = f"{msg_type} not supported by this transport"
            logger.warning("_dispatch_browser_message: %s", error_msg)
            if sender_ws:
                await sender_ws.send_json({"type": "error", "content": error_msg})
            return

        match msg_type:
            # Phase 2: permission response from browser
            case "permission_response":
                request_id = data.get("request_id", "")
                behavior = data.get("behavior", "deny")
                response = {
                    "behavior": behavior,
                    "updatedInput": data.get("updated_input", {}),
                }
                if data.get("updated_permissions"):
                    response["updatedPermissions"] = data["updated_permissions"]
                await self._transport.send_control_response(request_id, response)

            # Phase 3: interrupt current turn
            case "interrupt":
                await self._transport.send_control("interrupt")

            # Phase 3: change model mid-session
            case "set_model":
                model = data.get("model", "")
                if model:
                    await self._transport.send_control("set_model", model=model)

            # Phase 3: change thinking budget
            case "set_max_thinking_tokens":
                tokens = data.get("max_thinking_tokens", 0)
                await self._transport.send_control(
                    "set_max_thinking_tokens",
                    max_thinking_tokens=tokens,
                )

            # Phase 3: change permission mode at runtime
            case "set_permission_mode":
                mode = data.get("mode", "")
                if mode:
                    await self._transport.send_control(
                        "set_permission_mode",
                        permissionMode=mode,
                    )

            # Phase 3: rewind file changes to checkpoint
            case "rewind_files":
                await self._transport.send_control("rewind_files")

            # Phase 3: inject or reconfigure MCP servers
            case "mcp_set_servers":
                servers = data.get("servers", [])
                await self._transport.send_control(
                    "mcp_set_servers",
                    servers=servers,
                )

            # Default: treat as user message (backward compat with {"content": "..."})
            case _:
                message = data.get("content", "")
                if not message:
                    return

                # Record user turn in conversation history
                content_str = message if isinstance(message, str) else json.dumps(message)
                msg_id = str(uuid.uuid4())
                self._append_turn(
                    ConversationTurn(
                        id=msg_id,
                        role="user",
                        content=content_str,
                    )
                )

                # Echo back to all browsers so the message is confirmed
                await self._channels.broadcast(
                    {
                        "type": "user_confirmed",
                        "id": msg_id,
                        "content": content_str,
                    }
                )

                await self._transport.send_message(message)

    def _build_auth_headers(self) -> dict[str, str]:
        """Build authentication headers for Volundr API calls.

        Priority:
        1. VOLUNDR_API_TOKEN (long-lived PAT injected by Infisical) — preferred
           because user JWTs expire after minutes while PATs last for months.
        2. User JWT from WebSocket connection (fallback for dev/local)
        3. Empty (dev mode — no auth, Volundr backend must accept)
        """
        service_token = os.environ.get("VOLUNDR_API_TOKEN", "")
        if service_token:
            return {"Authorization": f"Bearer {service_token}"}

        if self._user_jwt:
            return {"Authorization": f"Bearer {self._user_jwt}"}

        logger.debug("No auth token available — requests will be unauthenticated")
        return {}

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Lazy-init HTTP client for Volundr API calls.

        Recreates the client when the JWT changes so the Authorization
        header stays current.
        """
        if self._http_client is not None and self._http_client_jwt != self._user_jwt:
            await self._http_client.aclose()
            self._http_client = None

        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                base_url=self.volundr_api_url,
                timeout=10.0,
                headers=self._build_auth_headers(),
            )
            self._http_client_jwt = self._user_jwt
        return self._http_client

    def _next_sequence(self) -> int:
        """Return a monotonically increasing sequence number."""
        seq = self._event_sequence
        self._event_sequence += 1
        return seq

    async def _emit_pipeline_event(
        self,
        event_type: str,
        data: dict,
        *,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost: float | None = None,
        duration_ms: int | None = None,
        model: str | None = None,
    ) -> None:
        """Emit a raw event to the Volundr event pipeline.

        Fires as a background task — must not raise or block the WebSocket.
        """
        if not self.volundr_api_url:
            return

        client = await self._get_http_client()
        from datetime import datetime

        payload = {
            "session_id": self.session_id,
            "event_type": event_type,
            "timestamp": datetime.now(UTC).isoformat(),
            "data": data,
            "sequence": self._next_sequence(),
        }

        if tokens_in is not None:
            payload["tokens_in"] = tokens_in
        if tokens_out is not None:
            payload["tokens_out"] = tokens_out
        if cost is not None:
            payload["cost"] = cost
        if duration_ms is not None:
            payload["duration_ms"] = duration_ms
        if model is not None:
            payload["model"] = model

        try:
            response = await client.post("/api/v1/volundr/events", json=payload)
            if response.status_code < 300:
                logger.debug("Pipeline event emitted: %s", event_type)
            else:
                logger.debug(
                    "Pipeline event failed (%d): %s",
                    response.status_code,
                    response.text[:200],
                )
        except Exception:
            logger.debug("Failed to emit pipeline event: %s", event_type, exc_info=True)

    async def _report_usage(self, result_data: dict) -> None:
        """Report token usage from a CLI result event to the Volundr API.

        Fires as a background task — must not raise or block the WebSocket.
        """
        if not self.volundr_api_url:
            return

        model_usage = result_data.get("modelUsage", {})
        if not model_usage:
            logger.debug("No modelUsage in result event, skipping usage report")
            return

        client = await self._get_http_client()
        url = f"/api/v1/volundr/sessions/{self.session_id}/usage"

        for model_id, usage in model_usage.items():
            tokens = (
                usage.get("inputTokens", 0)
                + usage.get("outputTokens", 0)
                + usage.get("cacheReadInputTokens", 0)
                + usage.get("cacheCreationInputTokens", 0)
            )
            if tokens <= 0:
                continue

            cost = usage.get("costUSD")
            payload = {
                "tokens": tokens,
                "provider": "cloud",
                "model": model_id,
                "message_count": 1,
            }
            if cost is not None:
                payload["cost"] = cost

            try:
                response = await client.post(url, json=payload)
                if response.status_code < 300:
                    logger.info(
                        "Reported usage: model=%s tokens=%d cost=%s",
                        model_id,
                        tokens,
                        cost,
                    )
                else:
                    logger.warning(
                        "Usage report failed (%d): %s",
                        response.status_code,
                        response.text[:200],
                    )
            except Exception:
                logger.warning("Failed to report usage for %s", model_id, exc_info=True)

    async def _report_timeline_event(self, event: dict) -> None:
        """Report a single timeline event to the Volundr API.

        Fires as a background task — must not raise or block the WebSocket.
        The event dict must contain at minimum: t, type, label.
        """
        if not self.volundr_api_url:
            return

        client = await self._get_http_client()
        url = f"/api/v1/volundr/chronicles/{self.session_id}/timeline"

        try:
            response = await client.post(url, json=event)
            if response.status_code < 300:
                logger.debug(
                    "Timeline event reported: type=%s, t=%d",
                    event.get("type"),
                    event.get("t", 0),
                )
            else:
                logger.debug(
                    "Timeline event report failed (%d): %s",
                    response.status_code,
                    response.text[:200],
                )
        except Exception:
            logger.debug(
                "Failed to report timeline event: type=%s",
                event.get("type"),
                exc_info=True,
            )

    @staticmethod
    def _classify_pipeline_event(tool_ev: dict) -> str:
        """Map a timeline tool event dict to a SessionEventType value."""
        ev_type = tool_ev.get("type", "")
        action = tool_ev.get("action", "")
        if ev_type == "file":
            if action == "created":
                return "file_created"
            if action == "deleted":
                return "file_deleted"
            return "file_modified"
        if ev_type == "git":
            return "git_commit"
        if ev_type == "terminal":
            return "terminal_command"
        return "tool_use"

    async def _report_session_start(self) -> None:
        """Report the session start timeline event (once)."""
        if self._session_start_reported:
            return
        self._session_start_reported = True
        await self._report_timeline_event(
            {
                "t": 0,
                "type": "session",
                "label": "Session started",
            }
        )
        # Emit session_start to event pipeline
        await self._emit_pipeline_event(
            "session_start",
            {
                "model": self.model,
                "session_name": self._settings.session.name,
            },
            model=self.model,
        )

    async def _report_activity_state(self, state: str) -> None:
        """Report activity state change to Volundr.

        States: active, idle, tool_executing.
        Debounces rapid transitions — only reports when state actually changes.
        """
        if state == self._activity_state:
            return

        self._activity_state = state
        now = time.monotonic()
        self._last_activity_report = now

        if not self.volundr_api_url:
            return

        metadata = {
            "turn_count": self._artifacts.turn_count,
            "duration_seconds": self._artifacts.duration_seconds,
        }

        try:
            client = await self._get_http_client()
            resp = await client.post(
                f"/api/v1/volundr/sessions/{self.session_id}/activity",
                json={"state": state, "metadata": metadata},
            )
            logger.info(
                "Activity report: state=%s status=%d url=%s",
                state,
                resp.status_code,
                resp.url,
            )
        except Exception:
            logger.warning(
                "Failed to report activity state %s",
                state,
                exc_info=True,
            )

    async def _generate_summary(self) -> dict:
        """Ask the CLI to generate a session summary.

        Returns a dict with ``summary``, ``key_changes``, and
        ``unfinished_work`` keys.  Falls back to artifacts data
        when the CLI is unavailable or times out.
        """
        if not self._transport or not self._transport.is_alive:
            logger.info("CLI not alive, skipping AI summary generation")
            return {
                "summary": None,
                "key_changes": self._artifacts.files_changed,
                "unfinished_work": None,
            }

        try:
            await self._transport.send_message(CHRONICLE_SUMMARY_PROMPT)

            # Wait for the result event (set by _handle_cli_message)
            deadline = time.monotonic() + SUMMARY_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                last = self._transport.last_result
                if last is not None:
                    break
                await asyncio.sleep(0.25)

            last = self._transport.last_result
            if last is None:
                logger.warning("Summary generation timed out after %ds", SUMMARY_TIMEOUT_SECONDS)
                return {
                    "summary": None,
                    "key_changes": self._artifacts.files_changed,
                    "unfinished_work": None,
                }

            # Extract text from result
            result_text = last.get("result", "")
            if not result_text:
                # Try to extract from content blocks
                for block in last.get("content", []):
                    if isinstance(block, dict) and block.get("type") == "text":
                        result_text = block.get("text", "")
                        break

            # Strip markdown fencing if present
            result_text = result_text.strip()
            if result_text.startswith("```"):
                lines = result_text.split("\n")
                lines = lines[1:]  # drop opening fence
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]  # drop closing fence
                result_text = "\n".join(lines).strip()

            parsed = json.loads(result_text)
            logger.info("AI summary generated successfully")
            return {
                "summary": parsed.get("summary"),
                "key_changes": parsed.get("key_changes", self._artifacts.files_changed),
                "unfinished_work": parsed.get("unfinished_work"),
            }
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to parse summary response: %s", e)
        except Exception:
            logger.warning("Summary generation failed", exc_info=True)

        return {
            "summary": None,
            "key_changes": self._artifacts.files_changed,
            "unfinished_work": None,
        }

    async def _report_chronicle(self) -> None:
        """Report chronicle summary data to the Volundr API on shutdown.

        Mirrors ``_report_usage`` — fires once during shutdown, best-effort,
        never raises.
        """
        if not self.volundr_api_url:
            return

        if self._artifacts.turn_count == 0:
            logger.info("No turns recorded, skipping chronicle report")
            return

        logger.info(
            "Generating chronicle report (turns=%d, files=%d, duration=%ds)",
            self._artifacts.turn_count,
            len(self._artifacts.files_changed),
            self._artifacts.duration_seconds,
        )

        try:
            summary_data = await self._generate_summary()

            client = await self._get_http_client()
            url = f"/api/v1/volundr/sessions/{self.session_id}/chronicle"

            payload: dict = {
                "duration_seconds": self._artifacts.duration_seconds,
            }
            if summary_data.get("summary"):
                payload["summary"] = summary_data["summary"]
            if summary_data.get("key_changes"):
                payload["key_changes"] = summary_data["key_changes"]
            if summary_data.get("unfinished_work"):
                payload["unfinished_work"] = summary_data["unfinished_work"]

            response = await client.post(url, json=payload)
            if response.status_code < 300:
                logger.info("Chronicle report submitted successfully")
            else:
                logger.warning(
                    "Chronicle report failed (%d): %s",
                    response.status_code,
                    response.text[:200],
                )

            # Emit session_stop to event pipeline
            await self._emit_pipeline_event(
                "session_stop",
                {
                    "reason": "shutdown",
                    "total_tokens": 0,
                    "duration_seconds": self._artifacts.duration_seconds,
                    "turn_count": self._artifacts.turn_count,
                    "files_changed": len(self._artifacts.files_changed),
                },
            )
        except Exception:
            logger.warning("Failed to report chronicle", exc_info=True)

    async def _init_telegram_channel(self) -> None:
        """Initialize and register a Telegram channel if configured."""
        tg_config = self._settings.telegram
        if not tg_config.enabled:
            return

        if not tg_config.bot_token or not tg_config.chat_id:
            logger.warning("Telegram enabled but bot_token or chat_id missing, skipping")
            return

        try:
            channel = TelegramChannel(
                bot_token=tg_config.bot_token,
                chat_id=tg_config.chat_id,
                notify_only=tg_config.notify_only,
                on_message=self._dispatch_browser_message,
            )
            await channel.start()
            self._channels.add(channel)
            logger.info("Telegram channel initialized for chat %s", tg_config.chat_id)
        except RuntimeError:
            logger.warning("python-telegram-bot not installed, Telegram channel disabled")
        except Exception:
            logger.warning("Failed to initialize Telegram channel", exc_info=True)

    def _update_jwt_from_websocket(self, websocket: WebSocket) -> None:
        """Extract and store JWT from an incoming WebSocket connection.

        Prefers the Authorization header (set by Envoy or reverse proxy),
        then falls back to the access_token query parameter (browser).
        Updates the stored JWT on each connection so token refreshes
        propagate automatically.
        """
        try:
            token = _extract_token_from_websocket(websocket)
        except Exception:
            logger.debug("Failed to extract JWT from WebSocket", exc_info=True)
            return
        if not token:
            if self._user_jwt is None:
                logger.warning("No JWT found on WebSocket connection")
            return

        self._user_jwt = token
        self._user_claims = _decode_jwt_claims(token)

        user_id = self._user_claims.get("sub", "unknown")
        logger.info("JWT updated from WebSocket connection (sub=%s)", user_id)

        # Propagate new auth headers to the chronicle watcher
        if self._chronicle_watcher is not None:
            self._chronicle_watcher.update_headers(self._build_auth_headers())

    async def handle_websocket(self, websocket: WebSocket) -> None:
        """Handle a browser WebSocket connection at /session."""
        # Extract JWT before accepting — headers are available pre-accept
        self._update_jwt_from_websocket(websocket)

        await websocket.accept()
        channel = WebSocketChannel(websocket)
        self._channels.add(channel)
        conn_count = self._channels.count
        logger.info("WebSocket connected, total channels: %d", conn_count)

        try:
            if not self._transport:
                logger.error("handle_websocket: transport not initialized")
                await websocket.send_json({"type": "error", "content": "Transport not initialized"})
                return

            # Lazy-start transport on first browser connection
            if not self._transport.is_alive:
                logger.info("handle_websocket: transport not alive, starting...")
                try:
                    await self._transport.start()
                    logger.info("handle_websocket: transport started successfully")
                except Exception as e:
                    logger.error(
                        "handle_websocket: transport.start() failed: %r",
                        e,
                        exc_info=True,
                    )
                    await websocket.send_json(
                        {
                            "type": "error",
                            "content": f"Transport start failed: {e}",
                        }
                    )
                    return
            else:
                logger.debug("handle_websocket: transport already alive")

            # Report session start to timeline (once, on first connection)
            asyncio.create_task(self._report_session_start())

            # Send welcome message
            await websocket.send_json(
                {"type": "system", "content": f"Connected to session {self.session_id}"}
            )
            logger.debug("handle_websocket: welcome message sent")

            # Send transport capabilities so the frontend knows which
            # controls to render.
            if self._transport:
                caps = {"type": "capabilities", **asdict(self._transport.capabilities)}
                await websocket.send_json(caps)
                logger.debug("handle_websocket: capabilities sent")

            # Replay conversation history so late-joining browsers see
            # earlier messages (including the initial prompt)
            if self._conversation_turns:
                logger.info(
                    "Replaying %d conversation turns to new browser",
                    len(self._conversation_turns),
                )
                await websocket.send_json(
                    {
                        "type": "conversation_history",
                        "turns": [asdict(t) for t in self._conversation_turns],
                    }
                )

            # Handle messages from browser
            while True:
                data = await websocket.receive_json()
                logger.debug(
                    "handle_websocket: browser msg: %s",
                    json.dumps(data)[:500],
                )
                try:
                    await self._dispatch_browser_message(data, sender_ws=websocket)
                except Exception as e:
                    logger.exception("Error processing browser message: %s", data)
                    await websocket.send_json({"type": "error", "content": str(e)})

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            logger.exception("WebSocket error")
            try:
                await websocket.send_json({"type": "error", "content": str(e)})
            except Exception:
                logger.debug("Failed to send error response to WebSocket", exc_info=True)
        finally:
            self._channels.remove(channel)
            remaining = self._channels.count
            logger.info("Connection closed, remaining channels: %d", remaining)

    async def handle_cli_websocket(self, websocket: WebSocket, session_id: str) -> None:
        """Handle the CLI WebSocket connection at /ws/cli/{session_id}.

        Only used by the SdkWebSocketTransport. The CLI process connects
        back to this endpoint after being spawned with --sdk-url.
        """
        logger.info(
            "handle_cli_websocket: incoming CLI connection for session=%s (transport=%s)",
            session_id,
            type(self._transport).__name__ if self._transport else None,
        )

        if not self._transport or not self._transport.capabilities.cli_websocket:
            logger.warning(
                "CLI WebSocket received but transport %s does not support SDK WebSocket protocol",
                type(self._transport).__name__ if self._transport else "None",
            )
            await websocket.close(code=1008, reason="SDK transport not active")
            return

        if session_id != self.session_id:
            logger.warning(
                "CLI WebSocket session mismatch: expected %s, got %s",
                self.session_id,
                session_id,
            )
            await websocket.close(code=1008, reason="Session ID mismatch")
            return

        logger.info("handle_cli_websocket: attaching CLI websocket to transport")
        await self._transport.attach_cli_websocket(websocket)

        # Block until the receive loop finishes (CLI disconnects)
        logger.info("handle_cli_websocket: waiting for CLI disconnect")
        await self._transport.wait_for_cli_disconnect()
        logger.info("handle_cli_websocket: CLI disconnected, handler returning")


# Global broker instance
broker = Broker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Attach JWT redaction filter after uvicorn has configured its loggers
    _redact_filter = _TokenRedactFilter()
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).addFilter(_redact_filter)

    await broker.startup()
    yield
    await broker.shutdown()


app = FastAPI(
    title="Skuld Broker",
    description="WebSocket broker for Claude Code CLI",
    version="0.3.0",
    lifespan=lifespan,
)

# Add CORS middleware — browser UI (hlidskjalf) is served from a different
# origin than the per-session Skuld pod, so cross-origin requests to /api/*
# need explicit CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {"status": "healthy", "session_id": broker.session_id}


@app.get("/ready")
async def ready() -> dict:
    """Readiness check endpoint."""
    is_ready = broker._transport is not None
    return {"ready": is_ready, "session_id": broker.session_id}


@app.websocket("/session")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for browser chat."""
    await broker.handle_websocket(websocket)


@app.websocket("/ws/cli/{session_id}")
async def cli_websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    """WebSocket endpoint for Claude Code CLI (via --sdk-url)."""
    await broker.handle_cli_websocket(websocket, session_id)


# --- Broker Log API ---


@app.get("/api/logs")
async def get_broker_logs(
    lines: int = Query(default=100, ge=1, le=2000),
    level: str = Query(default="DEBUG"),
) -> dict:
    """Return recent broker log entries from the in-memory ring buffer."""
    min_level = getattr(logging, level.upper(), logging.DEBUG)
    filtered = [entry for entry in _log_buffer if logging.getLevelName(entry["level"]) >= min_level]
    tail = list(filtered)[-lines:]
    return {
        "session_id": broker.session_id,
        "total": len(_log_buffer),
        "returned": len(tail),
        "lines": tail,
    }


# --- Conversation History API ---


@app.get("/api/conversation/history")
async def get_conversation_history() -> dict:
    """Return the full conversation history with activity state."""
    is_active = (
        broker._transport is not None
        and broker._transport.is_alive
        and bool(broker._pending_assistant_content or broker._pending_reasoning_text)
    )
    # Build a short activity description for the UI
    last_activity = ""
    if is_active:
        if broker._pending_assistant_content:
            # Last ~100 chars of what the assistant is writing
            last_activity = broker._pending_assistant_content[-100:]
        elif broker._pending_reasoning_text:
            last_activity = "Thinking..."
    return {
        "turns": [asdict(t) for t in broker._conversation_turns],
        "is_active": is_active,
        "last_activity": last_activity,
    }


# --- Capabilities API ---


@app.get("/api/capabilities")
async def get_capabilities() -> dict:
    """Return transport capabilities so the frontend knows which controls to render."""
    if not broker._transport:
        raise HTTPException(status_code=503, detail="Transport not initialized")
    return asdict(broker._transport.capabilities)


# --- Service Management API ---


@app.post("/api/services", response_model=ServiceStatus)
async def create_service(request: ServiceCreateRequest) -> ServiceStatus:
    """Start a new local service."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")
    return await broker.service_manager.add_service(request)


@app.get("/api/services", response_model=list[ServiceStatus])
async def list_services() -> list[ServiceStatus]:
    """List all local services."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")
    return await broker.service_manager.list_services()


@app.get("/api/services/{name}", response_model=ServiceStatus)
async def get_service(name: str) -> ServiceStatus:
    """Get status of a specific service."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")

    result = await broker.service_manager.get_service(name)
    if not result:
        raise HTTPException(status_code=404, detail=f"Service '{name}' not found")
    return result


@app.delete("/api/services/{name}")
async def delete_service(name: str) -> dict:
    """Stop and remove a local service."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")

    removed = await broker.service_manager.remove_service(name)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Service '{name}' not found")
    return {"status": "removed", "name": name}


@app.get("/api/services/{name}/logs")
async def get_service_logs(name: str, lines: int = 100) -> dict:
    """Get logs for a service."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")

    logs = await broker.service_manager.get_logs(name, lines=lines)
    if logs is None:
        raise HTTPException(status_code=404, detail=f"No logs found for service '{name}'")
    return {"name": name, "lines": lines, "logs": logs}


@app.post("/api/services/{name}/restart", response_model=ServiceStatus)
async def restart_service(name: str) -> ServiceStatus:
    """Restart a local service."""
    if not broker.service_manager:
        raise HTTPException(status_code=503, detail="Service manager not initialized")

    result = await broker.service_manager.restart_service(name)
    if not result:
        raise HTTPException(status_code=404, detail=f"Service '{name}' not found")
    return result


# --- Workspace File Listing API ---

# Directories that add noise and should be hidden from the file browser
_SKIP_NAMES = frozenset(
    {
        "node_modules",
        "__pycache__",
        ".git",
        "venv",
        ".venv",
        ".tox",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
    }
)

# Dotfiles/dotdirs that *should* be shown despite the general hidden-file rule
_SHOW_HIDDEN = frozenset({".github", ".claude", ".vscode"})


def _resolve_root(root: str) -> Path:
    """Return the resolved base directory for the given root name."""
    if root == "home":
        return Path(broker._settings.home_path).resolve()
    return Path(broker.workspace_dir).resolve()


def _sanitize_relative(relative_path: str) -> str:
    """Sanitize user-supplied path: reject NUL, normalize, reject traversal/absolute."""
    if "\0" in relative_path:
        raise HTTPException(400, "Invalid path")
    normalised = os.path.normpath(relative_path)
    # Disallow absolute paths
    if os.path.isabs(normalised):
        raise HTTPException(400, "Path traversal not allowed")
    # Disallow parent-directory references that could escape the base directory
    # (for example "foo/../../etc/passwd").
    parts = [p for p in normalised.split(os.sep) if p not in (".", "")]
    if any(part == os.pardir for part in parts):
        raise HTTPException(400, "Path traversal not allowed")
    return normalised


def _check_within_base(base: str | Path, target: str | Path) -> None:
    """Raise if *target* is not under *base*.

    Uses ``os.path.realpath`` + ``str.startswith`` so that CodeQL
    recognises the guard as a path-injection sanitiser.
    """
    base_real = os.path.realpath(str(base))
    target_real = os.path.realpath(str(target))
    if target_real != base_real and not target_real.startswith(base_real + os.sep):
        raise HTTPException(400, "Path traversal not allowed")


def _validate_root(root: str) -> None:
    """Validate root parameter is exactly 'workspace' or 'home'."""
    if root not in ("workspace", "home"):
        raise HTTPException(400, "root must be 'workspace' or 'home'")


@app.get("/api/files")
async def list_files(path: str = "", root: str = "workspace") -> dict:
    """List files and directories in a session root (workspace or home)."""
    _validate_root(root)
    base = _resolve_root(root)
    sanitized = _sanitize_relative(path)
    base_real = os.path.realpath(str(base))
    target_real = os.path.realpath(os.path.join(base_real, sanitized))
    _check_within_base(base_real, target_real)
    target = Path(target_real)

    if not target.is_dir():
        raise HTTPException(404, "Directory not found")

    try:
        items = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    entries: list[dict] = []
    for item in items:
        if item.name.startswith(".") and item.name not in _SHOW_HIDDEN:
            continue
        if item.name in _SKIP_NAMES:
            continue
        stat = item.stat(follow_symlinks=False)
        entries.append(
            {
                "name": item.name,
                "path": str(item.relative_to(base)),
                "type": "directory" if item.is_dir() else "file",
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
            }
        )

    return {"entries": entries}


@app.get("/api/files/download")
async def download_file(path: str, root: str = "workspace") -> FileResponse:
    """Download a single file from the session."""
    _validate_root(root)
    base = _resolve_root(root)
    sanitized = _sanitize_relative(path)
    base_real = os.path.realpath(str(base))
    target_real = os.path.realpath(os.path.join(base_real, sanitized))
    _check_within_base(base_real, target_real)

    if not os.path.isfile(target_real):
        raise HTTPException(404, "File not found")

    return FileResponse(
        path=target_real,
        filename=os.path.basename(target_real),
        media_type="application/octet-stream",
    )


@app.post("/api/files/upload")
async def upload_files(
    files: list[UploadFile],
    path: str = "",
    root: str = "workspace",
) -> dict:
    """Upload files to a target directory in the session."""
    _validate_root(root)
    base = _resolve_root(root)
    sanitized = _sanitize_relative(path)
    base_real = os.path.realpath(str(base))
    dir_real = os.path.realpath(os.path.join(base_real, sanitized))
    _check_within_base(base_real, dir_real)

    if not os.path.isdir(dir_real):
        raise HTTPException(404, "Target directory not found")

    max_size = broker._settings.max_upload_size_bytes
    uploaded: list[dict] = []
    for upload in files:
        if upload.filename is None:
            continue
        # Prevent path traversal in filenames
        safe_name = os.path.basename(upload.filename)
        dest_real = os.path.realpath(os.path.join(dir_real, safe_name))
        _check_within_base(base_real, dest_real)

        content = await upload.read()
        if len(content) > max_size:
            raise HTTPException(
                413,
                f"File {safe_name} exceeds maximum upload size ({max_size} bytes)",
            )
        with open(dest_real, "wb") as f:
            f.write(content)
        stat = os.stat(dest_real)
        uploaded.append(
            {
                "name": safe_name,
                "path": os.path.relpath(dest_real, base_real),
                "type": "file",
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
            }
        )

    return {"entries": uploaded}


class MkdirRequest(BaseModel):
    path: str
    root: str = "workspace"


@app.post("/api/files/mkdir")
async def mkdir(body: MkdirRequest) -> dict:
    """Create a directory."""
    _validate_root(body.root)
    base = _resolve_root(body.root)
    sanitized = _sanitize_relative(body.path)
    base_real = os.path.realpath(str(base))
    target_real = os.path.realpath(os.path.join(base_real, sanitized))
    _check_within_base(base_real, target_real)

    if os.path.exists(target_real):
        raise HTTPException(409, "Path already exists")

    try:
        os.makedirs(target_real, exist_ok=False)
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    stat = os.stat(target_real)
    return {
        "name": os.path.basename(target_real),
        "path": os.path.relpath(target_real, base_real),
        "type": "directory",
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
    }


@app.delete("/api/files")
async def delete_file(path: str, root: str = "workspace") -> dict:
    """Delete a file or directory."""
    _validate_root(root)
    if not path:
        raise HTTPException(400, "Cannot delete root directory")
    base = _resolve_root(root)
    sanitized = _sanitize_relative(path)
    base_real = os.path.realpath(str(base))
    target_real = os.path.realpath(os.path.join(base_real, sanitized))
    _check_within_base(base_real, target_real)

    if not os.path.exists(target_real):
        raise HTTPException(404, "Path not found")

    try:
        if os.path.isdir(target_real):
            shutil.rmtree(target_real)
            return {"deleted": os.path.relpath(target_real, base_real)}
        os.unlink(target_real)
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    return {"deleted": os.path.relpath(target_real, base_real)}


def _parse_diff_output(raw: str, file_path: str) -> dict:
    """Parse unified diff output into structured hunks."""
    hunks: list[dict] = []
    current_hunk: dict | None = None

    for line in raw.splitlines():
        # Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        if line.startswith("@@"):
            parts = line.split("@@")
            if len(parts) < 2:
                continue
            header = parts[1].strip()
            tokens = header.split()
            old_start, old_count = 0, 0
            new_start, new_count = 0, 0
            for token in tokens:
                if token.startswith("-"):
                    nums = token[1:].split(",")
                    old_start = int(nums[0])
                    old_count = int(nums[1]) if len(nums) > 1 else 1
                elif token.startswith("+"):
                    nums = token[1:].split(",")
                    new_start = int(nums[0])
                    new_count = int(nums[1]) if len(nums) > 1 else 1
            current_hunk = {
                "oldStart": old_start,
                "oldCount": old_count,
                "newStart": new_start,
                "newCount": new_count,
                "lines": [],
            }
            hunks.append(current_hunk)
            continue

        if current_hunk is None:
            continue

        if line.startswith("+"):
            current_hunk["lines"].append(
                {
                    "type": "add",
                    "content": line[1:],
                    "newLine": new_start,
                }
            )
            new_start += 1
        elif line.startswith("-"):
            current_hunk["lines"].append(
                {
                    "type": "remove",
                    "content": line[1:],
                    "oldLine": old_start,
                }
            )
            old_start += 1
        elif line.startswith(" "):
            current_hunk["lines"].append(
                {
                    "type": "context",
                    "content": line[1:],
                    "oldLine": old_start,
                    "newLine": new_start,
                }
            )
            old_start += 1
            new_start += 1

    return {"filePath": file_path, "hunks": hunks}


@app.get("/api/diff")
async def get_diff(
    file: str = Query(..., description="File path relative to workspace"),
    base: str = Query(
        default="last-commit",
        description="Diff base: last-commit or default-branch",
    ),
) -> dict:
    """Return parsed git diff for a single file."""
    workspace = Path(broker.workspace_dir).resolve()
    target = (workspace / file).resolve()

    if not str(target).startswith(str(workspace)):
        raise HTTPException(400, "Path traversal not allowed")

    if base == "last-commit":
        cmd = ["git", "diff", "HEAD", "--", file]
    elif base == "default-branch":
        cmd = ["git", "diff", "main...HEAD", "--", file]
    else:
        raise HTTPException(400, f"Invalid base: {base}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    except TimeoutError:
        raise HTTPException(504, "git diff timed out")

    if proc.returncode not in (0, 1):
        detail = stderr.decode(errors="replace").strip()
        logger.warning("git diff failed for %s: %s", file, detail)
        raise HTTPException(502, f"git diff failed: {detail}")

    raw = stdout.decode(errors="replace")
    return _parse_diff_output(raw, file)


@app.get("/api/diff/files")
async def get_diff_files(
    base: str = Query(
        default="last-commit",
        description="Diff base: last-commit or default-branch",
    ),
) -> dict:
    """Return list of changed files with insertion/deletion counts."""
    workspace = Path(broker.workspace_dir).resolve()

    if base == "last-commit":
        cmd = ["git", "diff", "HEAD", "--numstat"]
    elif base == "default-branch":
        cmd = ["git", "diff", "main...HEAD", "--numstat"]
    else:
        raise HTTPException(400, f"Invalid base: {base}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    except TimeoutError:
        raise HTTPException(504, "git diff timed out")

    if proc.returncode not in (0, 1):
        detail = stderr.decode(errors="replace").strip()
        logger.warning("git diff --numstat failed: %s", detail)
        raise HTTPException(502, f"git diff failed: {detail}")

    files = []
    for line in stdout.decode(errors="replace").strip().splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        ins_str, del_str, path = parts
        ins = int(ins_str) if ins_str != "-" else 0
        del_ = int(del_str) if del_str != "-" else 0
        files.append({"path": path, "status": "mod", "ins": ins, "del": del_})

    return {"files": files}


class _SendMessageRequest(BaseModel):
    """Request body for session-to-session messaging."""

    session_id: str
    content: str


@app.post("/api/message")
async def send_message_to_session(body: _SendMessageRequest) -> dict:
    """Send a message to another session via Volundr's WS proxy.

    The broker injects its own auth token so the calling session
    never sees credentials.
    """
    if not broker.volundr_api_url:
        raise HTTPException(503, "Volundr API URL not configured")

    client = await broker._get_http_client()
    url = f"/api/v1/volundr/sessions/{body.session_id}/messages"
    try:
        resp = await client.post(url, json={"content": body.content})
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Volundr error: {e.response.text[:500]}")
    except httpx.RequestError as e:
        raise HTTPException(502, f"Failed to reach Volundr: {e}")

    return {"status": "sent", "target_session_id": body.session_id}


class _TokenRedactFilter(logging.Filter):
    """Redact access_token values from log messages to prevent JWT leaks."""

    _pattern = re.compile(r"access_token=[^\s\"&]+")

    def filter(self, record: logging.LogRecord) -> bool:
        if hasattr(record, "msg") and isinstance(record.msg, str):
            record.msg = self._pattern.sub("access_token=[REDACTED]", record.msg)
        return True


def main() -> None:
    """Run the broker server."""
    import uvicorn

    settings = SkuldSettings()
    logger.info("Starting Skuld broker on %s:%d", settings.host, settings.port)
    uvicorn.run(app, host=settings.host, port=settings.port, access_log=False)


if __name__ == "__main__":
    main()
