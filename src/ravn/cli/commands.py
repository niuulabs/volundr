"""Ravn CLI entry point."""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
import sys
from pathlib import Path
from typing import Any

import typer

from ravn.agent import PostToolHook, PreToolHook, RavnAgent
from ravn.config import InitiativeConfig, OutcomeConfig, ProjectConfig, Settings
from ravn.domain.models import Session, TokenUsage, ToolCall, ToolResult

logger = logging.getLogger(__name__)

app = typer.Typer(
    name="ravn",
    help="Ravn — conversational AI agent with tool calling.",
    add_completion=False,
)

approvals_app = typer.Typer(
    name="ravn-approvals",
    help="Manage per-project command approval patterns.",
    add_completion=False,
)


def approvals_main() -> None:
    approvals_app()


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _import_class(dotted_path: str) -> type:
    """Dynamically import a class from a fully-qualified dotted path."""
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def _inject_secrets(kwargs: dict[str, Any], secret_map: dict[str, str]) -> dict[str, Any]:
    """Resolve env var names from *secret_map* and merge into *kwargs*."""
    merged = dict(kwargs)
    for kwarg_name, env_var in secret_map.items():
        value = os.environ.get(env_var, "")
        if value:
            merged[kwarg_name] = value
    return merged


def _resolve_workspace(settings: Settings) -> Path:
    """Return the workspace root from config, defaulting to cwd."""
    ws = settings.permission.workspace_root
    return Path(ws).resolve() if ws else Path.cwd()


def _configure_logging(settings: Settings) -> None:
    """Apply logging config from settings."""
    level = getattr(logging, settings.logging.level.upper(), logging.WARNING)
    fmt = (
        "%(asctime)s %(name)s %(levelname)s %(message)s"
        if settings.logging.format == "text"
        else "%(message)s"
    )
    logging.basicConfig(level=level, format=fmt, force=True)


# ---------------------------------------------------------------------------
# Builder: LLM
# ---------------------------------------------------------------------------


def _build_llm(settings: Settings) -> Any:
    """Build the LLM adapter (with optional fallback chain).

    The primary adapter is loaded dynamically from ``llm.provider.adapter``
    (defaults to ``AnthropicAdapter``).  Anthropic-specific defaults
    (``api_key``, ``base_url``) are injected automatically when the default
    adapter is used.
    """
    from ravn.ports.llm import LLMPort

    prov = settings.llm.provider
    cls = _import_class(prov.adapter)
    kwargs = _inject_secrets(dict(prov.kwargs), prov.secret_kwargs_env)

    # For the default Anthropic adapter inject well-known top-level settings.
    if prov.adapter == "ravn.adapters.llm.anthropic.AnthropicAdapter":
        kwargs.setdefault("api_key", settings.effective_api_key())
        kwargs.setdefault("base_url", settings.anthropic.base_url)

    kwargs.setdefault("model", settings.effective_model())
    kwargs.setdefault("max_tokens", settings.effective_max_tokens())
    kwargs.setdefault("max_retries", settings.llm.max_retries)
    kwargs.setdefault("retry_base_delay", settings.llm.retry_base_delay)
    kwargs.setdefault("timeout", settings.llm.timeout)

    primary: LLMPort = cls(**kwargs)

    if not settings.llm.fallbacks:
        return primary

    from ravn.adapters.llm.fallback import FallbackLLMAdapter

    providers: list[LLMPort] = [primary]
    for fb in settings.llm.fallbacks:
        fb_cls = _import_class(fb.adapter)
        fb_kwargs = _inject_secrets(dict(fb.kwargs), fb.secret_kwargs_env)
        providers.append(fb_cls(**fb_kwargs))

    return FallbackLLMAdapter(providers=providers)


# ---------------------------------------------------------------------------
# Builder: Memory + Embedding
# ---------------------------------------------------------------------------


def _build_memory(settings: Settings, llm: Any = None) -> Any:
    """Build the memory adapter (SQLite or Postgres), or None."""
    backend = settings.memory.backend

    embedding_port = None
    if settings.embedding.enabled:
        try:
            cls = _import_class(settings.embedding.adapter)
            kwargs = _inject_secrets(
                settings.embedding.kwargs,
                settings.embedding.secret_kwargs_env,
            )
            embedding_port = cls(**kwargs)
        except Exception as exc:
            logger.warning("Failed to load embedding adapter: %s — falling back to FTS-only", exc)

    if backend == "sqlite":
        from ravn.adapters.memory.sqlite import SqliteMemoryAdapter

        return SqliteMemoryAdapter(
            path=settings.memory.path,
            max_retries=settings.memory.max_retries,
            min_jitter_ms=settings.memory.min_retry_jitter_ms,
            max_jitter_ms=settings.memory.max_retry_jitter_ms,
            checkpoint_interval=settings.memory.checkpoint_interval,
            prefetch_budget=settings.memory.prefetch_budget,
            prefetch_limit=settings.memory.prefetch_limit,
            prefetch_min_relevance=settings.memory.prefetch_min_relevance,
            recency_half_life_days=settings.memory.recency_half_life_days,
            session_search_truncate_chars=settings.memory.session_search_truncate_chars,
            embedding_port=embedding_port,
            rrf_k=settings.embedding.rrf_k,
            semantic_candidate_limit=settings.embedding.semantic_candidate_limit,
        )

    if backend == "postgres":
        from ravn.adapters.memory.postgres import PostgresMemoryAdapter

        dsn = os.environ.get(settings.memory.dsn_env, "") if settings.memory.dsn_env else ""
        dsn = dsn or settings.memory.dsn
        if not dsn:
            logger.warning(
                "Postgres memory backend configured but no DSN provided — memory disabled",
            )
            return None
        return PostgresMemoryAdapter(dsn=dsn)

    if backend == "buri":
        from ravn.adapters.memory.buri import BuriMemoryAdapter

        dsn = os.environ.get(settings.memory.dsn_env, "") if settings.memory.dsn_env else ""
        dsn = dsn or settings.memory.dsn
        if not dsn:
            logger.warning(
                "Buri memory backend configured but no DSN provided — memory disabled",
            )
            return None
        bc = settings.buri
        reflection_model = settings.agent.outcome.reflection_model
        return BuriMemoryAdapter(
            dsn=dsn,
            prefetch_budget=settings.memory.prefetch_budget,
            prefetch_limit=settings.memory.prefetch_limit,
            prefetch_min_relevance=settings.memory.prefetch_min_relevance,
            recency_half_life_days=settings.memory.recency_half_life_days,
            session_search_truncate_chars=settings.memory.session_search_truncate_chars,
            cluster_merge_threshold=bc.cluster_merge_threshold,
            extraction_model=bc.extraction_model,
            reflection_model=reflection_model,
            min_confidence=bc.min_confidence,
            session_summary_max_tokens=bc.session_summary_max_tokens,
            supersession_cosine_threshold=bc.supersession_cosine_threshold,
            llm=llm,
        )

    # Custom backend via fully-qualified class path
    try:
        cls = _import_class(backend)
        return cls(path=settings.memory.path)
    except Exception as exc:
        logger.warning("Failed to load custom memory backend %r: %s", backend, exc)
        return None


# ---------------------------------------------------------------------------
# Builder: Outcome
# ---------------------------------------------------------------------------


def _build_outcome(settings: Settings) -> tuple[Any, OutcomeConfig | None]:
    """Build the outcome adapter, or (None, None) if disabled."""
    oc = settings.agent.outcome
    if not oc.enabled:
        return None, None

    from ravn.adapters.memory.outcome import SQLiteOutcomeAdapter

    adapter = SQLiteOutcomeAdapter(
        path=oc.path,
        lessons_token_budget=oc.lessons_token_budget,
    )
    return adapter, oc


# ---------------------------------------------------------------------------
# Builder: Permission
# ---------------------------------------------------------------------------


def _build_permission(
    settings: Settings,
    workspace: Path,
    *,
    no_tools: bool,
    persona_config: Any | None,
) -> Any:
    """Build the permission adapter from config."""
    from ravn.adapters.permission.allow_deny import AllowAllPermission, DenyAllPermission

    if no_tools:
        return DenyAllPermission()

    if persona_config is not None and persona_config.permission_mode == "read-only":
        return DenyAllPermission()

    mode = settings.permission.mode

    if mode in ("allow_all", "full_access"):
        return AllowAllPermission()

    if mode == "deny_all":
        return DenyAllPermission()

    # Rich permission enforcer for workspace_write, read_only, prompt modes
    from ravn.adapters.memory.approval import ApprovalMemory
    from ravn.adapters.permission.enforcer import PermissionEnforcer

    return PermissionEnforcer(
        config=settings.permission,
        workspace_root=workspace,
        approval_memory=ApprovalMemory(project_root=workspace),
    )


# ---------------------------------------------------------------------------
# Builder: Tools
# ---------------------------------------------------------------------------


def _build_tools(
    settings: Settings,
    workspace: Path,
    session: Session,
    llm: Any,
    memory: Any | None,
    iteration_budget: Any | None,
    *,
    no_tools: bool = False,
    persona_config: Any | None = None,
) -> list[Any]:
    """Build the full tool list from config."""
    if no_tools:
        return []

    from ravn.adapters.tools.ask_user import AskUserTool
    from ravn.adapters.tools.bash import BashTool
    from ravn.adapters.tools.file_tools import (
        EditFileTool,
        GlobSearchTool,
        GrepSearchTool,
        ReadFileTool,
        WriteFileTool,
    )
    from ravn.adapters.tools.git import (
        GitAddTool,
        GitCheckoutTool,
        GitCommitTool,
        GitDiffTool,
        GitLogTool,
        GitPrTool,
        GitStatusTool,
    )
    from ravn.adapters.tools.introspection import (
        RavnMemorySearchTool,
        RavnReflectTool,
        RavnStateTool,
    )
    from ravn.adapters.tools.session_search import SessionSearchTool
    from ravn.adapters.tools.todo import TodoReadTool, TodoWriteTool
    from ravn.adapters.tools.web_fetch import WebFetchTool
    from ravn.adapters.tools.web_search import WebSearchTool
    from ravn.ports.tool import ToolPort

    fc = settings.tools.file
    tools: list[ToolPort] = [
        # -- File tools --
        ReadFileTool(workspace, max_bytes=fc.max_read_bytes),
        WriteFileTool(
            workspace,
            max_bytes=fc.max_write_bytes,
            binary_check_bytes=fc.binary_check_bytes,
        ),
        EditFileTool(
            workspace,
            max_bytes=fc.max_write_bytes,
            binary_check_bytes=fc.binary_check_bytes,
        ),
        GlobSearchTool(workspace),
        GrepSearchTool(workspace),
        # -- Git tools --
        GitStatusTool(workspace),
        GitDiffTool(workspace),
        GitAddTool(workspace),
        GitCommitTool(workspace),
        GitCheckoutTool(workspace),
        GitLogTool(workspace),
        GitPrTool(workspace),
        # -- Bash tool --
        BashTool(config=settings.tools.bash, workspace_root=workspace),
        # -- Web tools --
        WebFetchTool(
            timeout=settings.tools.web.fetch.timeout,
            user_agent=settings.tools.web.fetch.user_agent,
            content_budget=settings.tools.web.fetch.content_budget,
        ),
        # -- Todo tools --
        TodoWriteTool(session),
        TodoReadTool(session),
        # -- Ask user --
        AskUserTool(),
    ]

    # -- Terminal tool (local or docker) --
    tc = settings.tools.terminal
    if tc.backend == "docker":
        from ravn.adapters.tools.terminal_docker import DockerTerminalTool

        tools.append(
            DockerTerminalTool(
                config=tc.docker,
                workspace_root=workspace,
                timeout_seconds=tc.timeout_seconds,
            )
        )
    else:
        from ravn.adapters.tools.terminal import TerminalTool

        tools.append(
            TerminalTool(
                shell=tc.shell,
                timeout_seconds=tc.timeout_seconds,
                persistent_shell=tc.persistent_shell,
            )
        )

    # -- Web search (with pluggable provider) --
    ws_cfg = settings.tools.web.search
    search_provider = None
    if ws_cfg.provider.adapter != "ravn.adapters.tools.web_search.MockWebSearchProvider":
        try:
            cls = _import_class(ws_cfg.provider.adapter)
            kwargs = _inject_secrets(ws_cfg.provider.kwargs, ws_cfg.provider.secret_kwargs_env)
            search_provider = cls(**kwargs)
        except Exception as exc:
            logger.warning("Failed to load web search provider: %s — using mock", exc)
    tools.append(WebSearchTool(provider=search_provider, num_results=ws_cfg.num_results))

    # -- Skill tools (if enabled) --
    if settings.skill.enabled:
        from ravn.adapters.tools.skill_tools import SkillListTool, SkillRunTool

        if settings.skill.backend == "sqlite":
            from ravn.adapters.skill.sqlite import SqliteSkillAdapter

            skill_port = SqliteSkillAdapter(
                path=settings.skill.path,
                suggestion_threshold=settings.skill.suggestion_threshold,
                cache_max_entries=settings.skill.cache_max_entries,
            )
        else:
            from ravn.adapters.skill.file_registry import FileSkillRegistry

            skill_port = FileSkillRegistry(
                skill_dirs=settings.skill.skill_dirs or None,
                include_builtin=settings.skill.include_builtin,
                cwd=workspace,
            )
        tools.append(SkillListTool(skill_port))
        tools.append(SkillRunTool(skill_port))

    # -- Memory-dependent tools --
    if memory is not None:
        tools.append(RavnMemorySearchTool(memory))
        tools.append(SessionSearchTool(memory))
        tools.extend(memory.extra_tools(session_id=str(session.id)))

    # -- Custom tools from config --
    for ct in settings.tools.custom:
        try:
            cls = _import_class(ct.adapter)
            kwargs = _inject_secrets(ct.kwargs, ct.secret_kwargs_env)
            tools.append(cls(**kwargs))
        except Exception as exc:
            logger.warning("Failed to load custom tool %r: %s", ct.adapter, exc)

    # -- Platform tools (gateway/platform mode only) --
    if settings.gateway.platform.enabled:
        from ravn.adapters.tools.platform_tools import (
            TrackerIssueTool,
            TyrSagaTool,
            VolundrGitTool,
            VolundrSessionTool,
        )

        _purl = settings.gateway.platform.base_url
        _ptimeout = settings.gateway.platform.timeout
        tools.extend(
            [
                VolundrSessionTool(base_url=_purl, timeout=_ptimeout),
                VolundrGitTool(base_url=_purl, timeout=_ptimeout),
                TyrSagaTool(base_url=_purl, timeout=_ptimeout),
                TrackerIssueTool(base_url=_purl, timeout=_ptimeout),
            ]
        )

    # -- Introspection tools (added before filtering so they can be disabled) --
    state_tool = RavnStateTool(
        tool_names=[],  # populated after filtering
        permission_mode=settings.permission.mode,
        model=settings.effective_model(),
        persona=(
            persona_config.system_prompt_template[:40]
            if persona_config and persona_config.system_prompt_template
            else ""
        ),
        iteration_budget=iteration_budget,
        memory=memory,
    )
    tools.append(state_tool)
    tools.append(
        RavnReflectTool(
            llm,
            session,
            model=settings.agent.outcome.reflection_model,
            max_tokens=settings.agent.outcome.reflection_max_tokens,
        )
    )

    # -- Apply enabled/disabled filters --
    tools = _filter_tools(tools, settings, persona_config)

    # Update state tool with final tool names after filtering
    state_tool._tool_names = [t.name for t in tools]

    return tools


def _filter_tools(
    tools: list[Any],
    settings: Settings,
    persona_config: Any | None,
) -> list[Any]:
    """Apply enabled/disabled and persona tool filters."""
    enabled = set(settings.tools.enabled)
    disabled = set(settings.tools.disabled)

    if persona_config is not None:
        if persona_config.allowed_tools:
            persona_allowed = set(persona_config.allowed_tools)
            enabled = (enabled | persona_allowed) if enabled else persona_allowed
        if persona_config.forbidden_tools:
            disabled = disabled | set(persona_config.forbidden_tools)

    if enabled:
        tools = [t for t in tools if t.name in enabled]

    if disabled:
        tools = [t for t in tools if t.name not in disabled]

    return tools


# ---------------------------------------------------------------------------
# Builder: Hooks
# ---------------------------------------------------------------------------


def _build_hooks(settings: Settings) -> tuple[list[PreToolHook], list[PostToolHook]]:
    """Build pre/post tool hook callables from config."""
    pre: list[PreToolHook] = []
    post: list[PostToolHook] = []

    for hc in settings.hooks.pre_tool:
        try:
            cls = _import_class(hc.adapter)
            kwargs = _inject_secrets(hc.kwargs, hc.secret_kwargs_env)
            hook_port = cls(**kwargs)

            async def _pre(tool_call: ToolCall, _hp: Any = hook_port) -> None:
                await _hp.pre_execute(tool_call.name, tool_call.input, {})

            pre.append(_pre)
        except Exception as exc:
            logger.warning("Failed to load pre-tool hook %r: %s", hc.adapter, exc)

    for hc in settings.hooks.post_tool:
        try:
            cls = _import_class(hc.adapter)
            kwargs = _inject_secrets(hc.kwargs, hc.secret_kwargs_env)
            hook_port = cls(**kwargs)

            async def _post(
                tool_call: ToolCall,
                result: ToolResult,
                _hp: Any = hook_port,
            ) -> None:
                await _hp.post_execute(tool_call.name, tool_call.input, result, {})

            post.append(_post)
        except Exception as exc:
            logger.warning("Failed to load post-tool hook %r: %s", hc.adapter, exc)

    return pre, post


# ---------------------------------------------------------------------------
# Builder: Compression & Prompt Builder
# ---------------------------------------------------------------------------


def _build_compressor(settings: Settings, llm: Any) -> Any:
    """Build the context compressor, or None."""
    from ravn.compression import ContextCompressor

    cm = settings.context_management
    return ContextCompressor(
        llm=llm,
        model=settings.effective_model(),
        max_tokens=cm.compression_max_tokens,
        protect_first=cm.protect_first_messages,
        protect_last=cm.effective_protect_last(),
        compression_threshold=cm.compression_threshold,
    )


def _build_prompt_builder(settings: Settings) -> Any:
    """Build the prompt builder with cache, or None."""
    from ravn.prompt_builder import PromptBuilder, PromptCache

    cm = settings.context_management
    cache = PromptCache(
        max_entries=cm.prompt_cache_max_entries,
        cache_dir=cm.prompt_cache_dir,
    )
    return PromptBuilder(cache=cache)


# ---------------------------------------------------------------------------
# Builder: MCP (async — called after agent construction)
# ---------------------------------------------------------------------------


async def _start_mcp(
    settings: Settings,
    agent: RavnAgent,
) -> Any | None:
    """Start MCP servers and register discovered tools into the agent.

    Returns the MCPManager instance (for shutdown), or None if no MCP
    servers are configured.
    """
    if not settings.mcp_servers:
        return None

    from ravn.adapters.mcp.auth import MCPAuthSession
    from ravn.adapters.mcp.manager import MCPManager
    from ravn.adapters.tools.mcp import MCPAuthTool

    # Build token store
    ts_cfg = settings.mcp_token_store
    if ts_cfg.backend == "openbao":
        from ravn.adapters.mcp.auth import OpenBaoTokenStore

        store = OpenBaoTokenStore(
            url=ts_cfg.openbao_url,
            token_env=ts_cfg.openbao_token_env,
            mount=ts_cfg.openbao_mount,
            path_prefix=ts_cfg.openbao_path_prefix,
        )
    else:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=ts_cfg.local_path)

    auth_session = MCPAuthSession(store)
    builtin_names = set(agent._tools.keys())
    manager = MCPManager(settings.mcp_servers, builtin_tool_names=builtin_names)

    try:
        mcp_tools = await manager.start()
    except Exception as exc:
        logger.warning("MCP startup failed: %s — continuing without MCP tools", exc)
        return None

    # Register discovered tools into the agent
    for tool in mcp_tools:
        agent._tools[tool.name] = tool

    # Add the auth tool so the model can trigger auth flows
    server_configs = {s.name: s for s in settings.mcp_servers if s.enabled}
    auth_tool = MCPAuthTool(auth_session, server_configs, manager=manager)
    agent._tools[auth_tool.name] = auth_tool

    logger.info(
        "MCP started: %d server(s), %d tool(s) discovered",
        len(settings.mcp_servers),
        len(mcp_tools),
    )
    return manager


async def _start_mcp_shared(
    settings: Settings,
) -> tuple[Any | None, list[Any]]:
    """Start MCP servers and return (manager, tools) for gateway use.

    Unlike :func:`_start_mcp`, this does not inject tools into an agent
    because the gateway creates agents per-session.  The returned tool
    list should be appended to each session's tool list.
    """
    if not settings.mcp_servers:
        return None, []

    from ravn.adapters.mcp.auth import MCPAuthSession
    from ravn.adapters.mcp.manager import MCPManager
    from ravn.adapters.tools.mcp import MCPAuthTool

    ts_cfg = settings.mcp_token_store
    if ts_cfg.backend == "openbao":
        from ravn.adapters.mcp.auth import OpenBaoTokenStore

        store = OpenBaoTokenStore(
            url=ts_cfg.openbao_url,
            token_env=ts_cfg.openbao_token_env,
            mount=ts_cfg.openbao_mount,
            path_prefix=ts_cfg.openbao_path_prefix,
        )
    else:
        from ravn.adapters.mcp.auth import LocalEncryptedTokenStore

        store = LocalEncryptedTokenStore(path=ts_cfg.local_path)

    auth_session = MCPAuthSession(store)
    manager = MCPManager(settings.mcp_servers)

    try:
        mcp_tools: list[Any] = await manager.start()
    except Exception as exc:
        logger.warning("MCP startup failed: %s — continuing without MCP tools", exc)
        return None, []

    server_configs = {s.name: s for s in settings.mcp_servers if s.enabled}
    auth_tool = MCPAuthTool(auth_session, server_configs, manager=manager)
    mcp_tools.append(auth_tool)

    logger.info(
        "MCP started: %d server(s), %d tool(s) discovered",
        len(settings.mcp_servers),
        len(mcp_tools) - 1,  # exclude auth tool from count
    )
    return manager, mcp_tools


async def _shutdown_mcp(manager: Any | None) -> None:
    """Gracefully shut down MCP servers."""
    if manager is None:
        return
    try:
        await manager.shutdown()
    except Exception as exc:
        logger.warning("MCP shutdown error: %s", exc)


# ---------------------------------------------------------------------------
# User input function
# ---------------------------------------------------------------------------


async def _cli_user_input(question: str) -> str:
    """Prompt the user for input during ask_user tool calls."""
    return input(f"\n[Ravn asks] {question}\nYou: ").strip()


# ---------------------------------------------------------------------------
# Persona resolution (unchanged)
# ---------------------------------------------------------------------------


def _resolve_persona(
    persona_name: str,
    project_config: ProjectConfig | None,
) -> Any:
    """Load and merge a persona with optional ProjectConfig overrides."""
    from ravn.adapters.personas.loader import PersonaLoader

    loader = PersonaLoader()

    name = persona_name.strip() or (
        project_config.persona.strip() if project_config is not None else ""
    )
    if not name:
        return None

    persona = loader.load(name)
    if persona is None:
        typer.echo(f"Warning: persona '{name}' not found — using defaults.", err=True)
        return None

    if project_config is not None:
        persona = PersonaLoader.merge(persona, project_config)

    return persona


# ---------------------------------------------------------------------------
# Agent assembly
# ---------------------------------------------------------------------------


def _build_agent(
    settings: Settings,
    *,
    no_tools: bool = False,
    persona_config: Any | None = None,
) -> tuple[RavnAgent, Any]:
    api_key = settings.effective_api_key()
    if not api_key:
        typer.echo(
            "Error: No API key found. Set ANTHROPIC_API_KEY or configure ravn.yaml.",
            err=True,
        )
        raise typer.Exit(1)

    from ravn.adapters.channels.composite import CompositeChannel
    from ravn.adapters.cli_channel import CliChannel
    from ravn.budget import IterationBudget
    from ravn.ports.channel import ChannelPort

    workspace = _resolve_workspace(settings)
    llm = _build_llm(settings)
    session = Session()
    base_channel: CliChannel = CliChannel()
    channel: ChannelPort = base_channel
    if settings.sleipnir.enabled:
        from ravn.adapters.channels.sleipnir import SleipnirChannel

        sleipnir_ch = SleipnirChannel(
            settings.sleipnir,
            session_id=str(session.id),
            task_id=None,
        )
        channel = CompositeChannel([base_channel, sleipnir_ch])
    permission = _build_permission(
        settings,
        workspace,
        no_tools=no_tools,
        persona_config=persona_config,
    )
    memory = _build_memory(settings, llm=llm)
    outcome_port, outcome_config = _build_outcome(settings)
    iteration_budget = IterationBudget(
        total=settings.iteration_budget.total,
        near_limit_threshold=settings.iteration_budget.near_limit_threshold,
    )
    tools = _build_tools(
        settings,
        workspace,
        session,
        llm,
        memory,
        iteration_budget,
        no_tools=no_tools,
        persona_config=persona_config,
    )
    compressor = _build_compressor(settings, llm)
    prompt_builder = _build_prompt_builder(settings)
    pre_hooks, post_hooks = _build_hooks(settings)

    extended_thinking = (
        settings.llm.extended_thinking if settings.llm.extended_thinking.enabled else None
    )

    # Apply persona overrides
    system_prompt = settings.agent.system_prompt
    max_iterations = settings.agent.max_iterations
    if persona_config is not None:
        if persona_config.system_prompt_template:
            system_prompt = persona_config.system_prompt_template
        if persona_config.iteration_budget:
            max_iterations = persona_config.iteration_budget

    agent = RavnAgent(
        llm=llm,
        tools=tools,
        channel=channel,
        permission=permission,
        system_prompt=system_prompt,
        model=settings.effective_model(),
        max_tokens=settings.effective_max_tokens(),
        max_iterations=max_iterations,
        session=session,
        pre_tool_hooks=pre_hooks or None,
        post_tool_hooks=post_hooks or None,
        user_input_fn=_cli_user_input,
        memory=memory,
        episode_summary_max_chars=settings.agent.episode_summary_max_chars,
        episode_task_max_chars=settings.agent.episode_task_max_chars,
        iteration_budget=iteration_budget,
        compressor=compressor,
        prompt_builder=prompt_builder,
        outcome_port=outcome_port,
        outcome_config=outcome_config,
        extended_thinking=extended_thinking,
    )

    return agent, channel


def _make_slash_ctx(agent: RavnAgent, settings: Settings) -> Any:
    """Build a SlashCommandContext from the running agent and loaded settings."""
    from ravn.adapters.slash_commands import SlashCommandContext

    return SlashCommandContext(
        session=agent.session,
        tools=agent.tools,
        max_iterations=agent.max_iterations,
        llm_adapter_name=agent.llm_adapter_name,
        permission_mode=settings.permission.mode,
    )


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------


@app.command()
def run(
    prompt: str = typer.Argument(default="", help="Initial prompt. If empty, starts REPL."),
    no_tools: bool = typer.Option(False, "--no-tools", help="Disable all tool execution."),
    show_usage: bool = typer.Option(False, "--show-usage", help="Print token usage after turn."),
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
    persona: str = typer.Option(
        "", "--persona", "-p", help="Persona name (built-in or from ~/.ravn/personas/)."
    ),
) -> None:
    """Start a Ravn conversation. Pass a prompt for single-turn, or omit for REPL."""
    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    _configure_logging(settings)
    project_config = ProjectConfig.discover()
    persona_config = _resolve_persona(persona, project_config)
    agent, channel = _build_agent(settings, no_tools=no_tools, persona_config=persona_config)

    asyncio.run(_chat(agent, channel, settings=settings, prompt=prompt, show_usage=show_usage))


async def _chat(
    agent: RavnAgent,
    channel: Any,
    *,
    settings: Settings,
    prompt: str,
    show_usage: bool,
) -> None:
    """Run a single-turn or multi-turn conversation."""
    from ravn.adapters.slash_commands import handle as handle_slash

    mcp_manager = await _start_mcp(settings, agent)
    try:
        if prompt:
            await _run_turn(agent, channel, prompt, show_usage=show_usage, single_turn=True)
            return

        # REPL mode.
        typer.echo("Ravn — type your message or /help for commands. Ctrl+D to exit.\n")
        slash_ctx = _make_slash_ctx(agent, settings)
        while True:
            try:
                user_input = input("You: ").strip()
            except EOFError:
                break

            if not user_input:
                continue

            slash_output = handle_slash(user_input, slash_ctx)
            if slash_output is not None:
                typer.echo(slash_output)
                continue

            await _run_turn(agent, channel, user_input, show_usage=show_usage)
    finally:
        await _shutdown_mcp(mcp_manager)


async def _run_turn(
    agent: RavnAgent,
    channel: Any,
    user_input: str,
    *,
    show_usage: bool,
    single_turn: bool = False,
) -> None:
    try:
        result = await agent.run_turn(user_input)
        channel.finish()
        if show_usage:
            _print_usage(result.usage)
    except Exception as exc:
        channel.finish()
        typer.echo(f"\n[error] {exc}", err=True)
        if single_turn:
            sys.exit(1)


def _print_usage(usage: TokenUsage) -> None:
    parts = [f"in={usage.input_tokens}", f"out={usage.output_tokens}"]
    if usage.cache_read_tokens:
        parts.append(f"cache_read={usage.cache_read_tokens}")
    if usage.cache_write_tokens:
        parts.append(f"cache_write={usage.cache_write_tokens}")
    typer.echo(f"[tokens] {', '.join(parts)}")


# ---------------------------------------------------------------------------
# Approvals CLI
# ---------------------------------------------------------------------------


@approvals_app.command("list")
def approvals_list() -> None:
    """List all stored approval patterns for the current project."""
    from ravn.adapters.memory.approval import ApprovalMemory

    memory = ApprovalMemory()
    entries = memory.list_entries()
    if not entries:
        typer.echo("No approval patterns stored.")
        return
    typer.echo(f"Approval patterns ({len(entries)}):\n")
    for entry in entries:
        auto = entry.auto_approved_count
        typer.echo(f"  {entry.command!r}")
        typer.echo(f"    pattern      : {entry.pattern}")
        typer.echo(f"    approved_at  : {entry.approved_at}")
        typer.echo(f"    auto-approved: {auto} time(s)\n")


@approvals_app.command("revoke")
def approvals_revoke(
    pattern: str = typer.Argument(help="Command text or pattern to revoke."),
) -> None:
    """Revoke an approval pattern so the command will be prompted again."""
    from ravn.adapters.memory.approval import ApprovalMemory

    memory = ApprovalMemory()
    removed = memory.revoke(pattern)
    if removed:
        typer.echo(f"Revoked: {pattern!r}")
    else:
        typer.echo(f"No matching approval found for {pattern!r}", err=True)
        raise typer.Exit(1)


# ---------------------------------------------------------------------------
# Evolution CLI
# ---------------------------------------------------------------------------


evolve_app = typer.Typer(
    name="evolve",
    help="Self-improvement pattern extraction.",
    add_completion=False,
    invoke_without_command=True,
)
app.add_typer(evolve_app, name="evolve")


@evolve_app.callback(invoke_without_command=True)
def evolve(
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
) -> None:
    """Run the self-improvement pattern extraction pass.

    Analyses accumulated task outcomes and episodic memory to surface
    recurring tool sequences (skill suggestions), systematic errors
    (warnings), and effective strategies.  Results are printed as a
    human-readable diff — nothing is modified automatically.
    """
    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    _configure_logging(settings)

    if not settings.evolution.enabled:
        typer.echo("Evolution is disabled in config (evolution.enabled = false).")
        raise typer.Exit(0)

    asyncio.run(_run_evolve(settings))


async def _run_evolve(settings: Settings) -> None:
    from ravn.context.evolution import (
        PatternExtractor,
        load_state,
        save_state,
        should_run,
    )

    memory = _build_memory(settings)
    if memory is None:
        typer.echo("Memory backend not available — evolution requires memory.", err=True)
        raise typer.Exit(1)

    outcome_port, _ = _build_outcome(settings)
    if outcome_port is None:
        typer.echo("Outcome recording not enabled — evolution requires outcomes.", err=True)
        raise typer.Exit(1)

    evo = settings.evolution
    state_path = Path(evo.state_path).expanduser()
    state = load_state(state_path)
    current_count = await outcome_port.count_all_outcomes()

    if not should_run(state, current_count, min_new=evo.min_new_outcomes):
        typer.echo(
            f"Not enough new outcomes ({current_count - state.outcome_count_at_last_run} "
            f"since last run, need {evo.min_new_outcomes})."
        )
        return

    typer.echo(
        f"Analysing {current_count} outcomes "
        f"({current_count - state.outcome_count_at_last_run} new)..."
    )

    extractor = PatternExtractor(
        memory,
        outcome_port,
        max_episodes_to_analyze=evo.max_episodes_to_analyze,
        max_outcomes_to_analyze=evo.max_outcomes_to_analyze,
        skill_suggestion_min_occurrences=evo.skill_suggestion_min_occurrences,
        error_warning_min_occurrences=evo.error_warning_min_occurrences,
        strategy_min_occurrences=evo.strategy_min_occurrences,
        max_skill_suggestions=evo.max_skill_suggestions,
        max_system_warnings=evo.max_system_warnings,
        max_strategy_injections=evo.max_strategy_injections,
    )
    evolution = await extractor.extract()

    if evolution.is_empty():
        typer.echo("No patterns found.")
    else:
        typer.echo(evolution.as_diff())

    from datetime import UTC, datetime

    state.outcome_count_at_last_run = current_count
    state.last_run_at = datetime.now(UTC)
    save_state(state_path, state)
    typer.echo("Evolution state saved.")


# ---------------------------------------------------------------------------
# Gateway CLI
# ---------------------------------------------------------------------------


gateway_app = typer.Typer(
    name="ravn-gateway",
    help="Start the Ravn Pi-mode gateway (Telegram polling + local HTTP).",
    add_completion=False,
)


@gateway_app.command()
def gateway(
    telegram: bool = typer.Option(False, "--telegram", help="Enable Telegram polling channel."),
    http: bool = typer.Option(False, "--http", help="Enable local HTTP channel."),
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
    persona: str = typer.Option(
        "", "--persona", "-p", help="Persona name applied to all gateway sessions."
    ),
) -> None:
    """Start the Ravn gateway (Telegram polling + local HTTP server).

    Channels are enabled via flags or via the ``gateway:`` section of ravn.yaml.
    The gateway runs as asyncio tasks — no separate process required.

    Example config (ravn.yaml)::

        gateway:
          enabled: true
          channels:
            telegram:
              enabled: true
              token_env: TELEGRAM_BOT_TOKEN
              allowed_chat_ids: [123456789]
            http:
              enabled: true
              host: 0.0.0.0
              port: 7477
    """
    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    _configure_logging(settings)
    project_config = ProjectConfig.discover()
    persona_config = _resolve_persona(persona, project_config)

    # CLI flags override config file.
    if telegram:
        settings.gateway.channels.telegram.enabled = True
    if http:
        settings.gateway.channels.http.enabled = True

    if (
        not settings.gateway.channels.telegram.enabled
        and not settings.gateway.channels.http.enabled
    ):
        typer.echo(
            "No channels enabled. Use --telegram, --http, or set gateway.channels in config.",
            err=True,
        )
        raise typer.Exit(1)

    asyncio.run(_run_gateway(settings, persona_config=persona_config))


async def _run_gateway(
    settings: Settings,
    *,
    persona_config: Any | None = None,
) -> None:
    """Build and run the gateway until interrupted."""
    from ravn.adapters.channels.gateway import RavnGateway
    from ravn.adapters.channels.gateway_http import HttpGateway
    from ravn.adapters.channels.gateway_telegram import TelegramGateway
    from ravn.budget import IterationBudget
    from ravn.ports.channel import ChannelPort

    api_key = settings.effective_api_key()
    if not api_key:
        typer.echo(
            "Error: No API key found. Set ANTHROPIC_API_KEY or configure ravn.yaml.",
            err=True,
        )
        raise typer.Exit(1)

    # Shared resources (safe to reuse across sessions)
    workspace = _resolve_workspace(settings)
    llm = _build_llm(settings)
    memory = _build_memory(settings, llm=llm)
    outcome_port, outcome_config = _build_outcome(settings)
    compressor = _build_compressor(settings, llm)
    prompt_builder = _build_prompt_builder(settings)
    pre_hooks, post_hooks = _build_hooks(settings)

    extended_thinking = (
        settings.llm.extended_thinking if settings.llm.extended_thinking.enabled else None
    )

    system_prompt = settings.agent.system_prompt
    max_iterations = settings.agent.max_iterations
    if persona_config is not None:
        if persona_config.system_prompt_template:
            system_prompt = persona_config.system_prompt_template
        if persona_config.iteration_budget:
            max_iterations = persona_config.iteration_budget

    # Start MCP servers (shared across sessions)
    mcp_manager, mcp_tools = await _start_mcp_shared(settings)

    def _agent_factory(channel: ChannelPort) -> RavnAgent:
        # Per-session: fresh session, budget, and tools
        session = Session()
        budget = IterationBudget(
            total=settings.iteration_budget.total,
            near_limit_threshold=settings.iteration_budget.near_limit_threshold,
        )
        permission = _build_permission(
            settings,
            workspace,
            no_tools=False,
            persona_config=persona_config,
        )
        tools = _build_tools(
            settings,
            workspace,
            session,
            llm,
            memory,
            budget,
            persona_config=persona_config,
        )
        # Append shared MCP tools to per-session tool list
        tools.extend(mcp_tools)

        # Wrap with Sleipnir broadcast when enabled
        effective_channel: ChannelPort = channel
        if settings.sleipnir.enabled:
            from ravn.adapters.channels.composite import CompositeChannel
            from ravn.adapters.channels.sleipnir import SleipnirChannel

            sleipnir_ch = SleipnirChannel(
                settings.sleipnir,
                session_id=str(session.id),
                task_id=None,
            )
            effective_channel = CompositeChannel([channel, sleipnir_ch])

        return RavnAgent(
            llm=llm,
            tools=tools,
            channel=effective_channel,
            permission=permission,
            system_prompt=system_prompt,
            model=settings.effective_model(),
            max_tokens=settings.effective_max_tokens(),
            max_iterations=max_iterations,
            session=session,
            pre_tool_hooks=pre_hooks or None,
            post_tool_hooks=post_hooks or None,
            user_input_fn=None,  # Gateway has no stdin
            memory=memory,
            episode_summary_max_chars=settings.agent.episode_summary_max_chars,
            episode_task_max_chars=settings.agent.episode_task_max_chars,
            iteration_budget=budget,
            compressor=compressor,
            prompt_builder=prompt_builder,
            outcome_port=outcome_port,
            outcome_config=outcome_config,
            extended_thinking=extended_thinking,
        )

    gw = RavnGateway(settings.gateway, _agent_factory)

    tasks: list[asyncio.Task] = []

    if settings.gateway.channels.telegram.enabled:
        tg = TelegramGateway(settings.gateway.channels.telegram, gw)
        tasks.append(asyncio.create_task(tg.run(), name="telegram"))

    if settings.gateway.channels.http.enabled:
        ht = HttpGateway(settings.gateway.channels.http, gw)
        tasks.append(asyncio.create_task(ht.run(), name="http"))

    typer.echo(f"Gateway started ({len(tasks)} channel(s) active). Press Ctrl+C to stop.")

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    except KeyboardInterrupt:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await _shutdown_mcp(mcp_manager)


@app.command()
def daemon(
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
    persona: str = typer.Option(
        "", "--persona", "-p", help="Persona name applied to all daemon sessions."
    ),
) -> None:
    """Start gateway channels AND drive loop simultaneously.  Never exits.

    Channels and triggers are configured via the ``gateway:`` and
    ``initiative:`` sections of ravn.yaml.  The daemon runs until Ctrl+C
    or SIGTERM.
    """
    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    _configure_logging(settings)
    project_config = ProjectConfig.discover()
    persona_config = _resolve_persona(persona, project_config)

    asyncio.run(_run_daemon(settings, persona_config=persona_config))


async def _run_daemon(
    settings: Settings,
    *,
    persona_config: Any | None = None,
) -> None:
    """Build and run the gateway + drive loop until interrupted."""
    from ravn.adapters.channels.gateway import RavnGateway
    from ravn.adapters.channels.gateway_http import HttpGateway
    from ravn.adapters.channels.gateway_telegram import TelegramGateway
    from ravn.budget import IterationBudget
    from ravn.drive_loop import DriveLoop
    from ravn.ports.channel import ChannelPort

    api_key = settings.effective_api_key()
    if not api_key:
        typer.echo(
            "Error: No API key found. Set ANTHROPIC_API_KEY or configure ravn.yaml.",
            err=True,
        )
        raise typer.Exit(1)

    workspace = _resolve_workspace(settings)
    llm = _build_llm(settings)
    memory = _build_memory(settings)
    outcome_port, outcome_config = _build_outcome(settings)
    compressor = _build_compressor(settings, llm)
    prompt_builder = _build_prompt_builder(settings)
    pre_hooks, post_hooks = _build_hooks(settings)

    extended_thinking = (
        settings.llm.extended_thinking if settings.llm.extended_thinking.enabled else None
    )

    system_prompt = settings.agent.system_prompt
    max_iterations = settings.agent.max_iterations
    if persona_config is not None:
        if persona_config.system_prompt_template:
            system_prompt = persona_config.system_prompt_template
        if persona_config.iteration_budget:
            max_iterations = persona_config.iteration_budget

    mcp_manager, mcp_tools = await _start_mcp_shared(settings)

    def _agent_factory(channel: ChannelPort, task_id: str | None = None) -> Any:
        session = Session()
        budget = IterationBudget(
            total=settings.iteration_budget.total,
            near_limit_threshold=settings.iteration_budget.near_limit_threshold,
        )
        permission = _build_permission(
            settings,
            workspace,
            no_tools=False,
            persona_config=persona_config,
        )
        tools = _build_tools(
            settings,
            workspace,
            session,
            llm,
            memory,
            budget,
            persona_config=persona_config,
        )
        tools.extend(mcp_tools)

        return RavnAgent(
            llm=llm,
            tools=tools,
            channel=channel,
            permission=permission,
            system_prompt=system_prompt,
            model=settings.effective_model(),
            max_tokens=settings.effective_max_tokens(),
            max_iterations=max_iterations,
            session=session,
            pre_tool_hooks=pre_hooks or None,
            post_tool_hooks=post_hooks or None,
            user_input_fn=None,
            memory=memory,
            episode_summary_max_chars=settings.agent.episode_summary_max_chars,
            episode_task_max_chars=settings.agent.episode_task_max_chars,
            iteration_budget=budget,
            compressor=compressor,
            prompt_builder=prompt_builder,
            outcome_port=outcome_port,
            outcome_config=outcome_config,
            extended_thinking=extended_thinking,
        )

    tasks: list[asyncio.Task] = []

    # Gateway channels (human-initiated turns)
    gw_tasks: list[str] = []
    if settings.gateway.channels.telegram.enabled or settings.gateway.channels.http.enabled:
        gw = RavnGateway(settings.gateway, _agent_factory)

        if settings.gateway.channels.telegram.enabled:
            tg = TelegramGateway(settings.gateway.channels.telegram, gw)
            tasks.append(asyncio.create_task(tg.run(), name="telegram"))
            gw_tasks.append("telegram")

        if settings.gateway.channels.http.enabled:
            ht = HttpGateway(settings.gateway.channels.http, gw)
            tasks.append(asyncio.create_task(ht.run(), name="http"))
            gw_tasks.append("http")

    # Drive loop (initiative tasks)
    from ravn.adapters.events.noop_publisher import NoOpEventPublisher
    from ravn.adapters.events.rabbitmq_publisher import RabbitMQEventPublisher
    from ravn.ports.event_publisher import EventPublisherPort

    event_publisher: EventPublisherPort = NoOpEventPublisher()
    trigger_names: list[str] = []
    if settings.initiative.enabled:
        if settings.sleipnir.enabled:
            event_publisher = RabbitMQEventPublisher(settings.sleipnir)

        drive_loop = DriveLoop(
            agent_factory=_agent_factory,
            config=settings.initiative,
            settings=settings,
            event_publisher=event_publisher,
        )
        _wire_triggers(drive_loop, settings.initiative)
        trigger_names = [t.name for t in drive_loop._triggers]
        tasks.append(asyncio.create_task(drive_loop.run(), name="drive_loop"))

    channels_str = ", ".join(gw_tasks) if gw_tasks else "none"
    triggers_str = ", ".join(trigger_names) if trigger_names else "none"
    concurrent = settings.initiative.max_concurrent_tasks if settings.initiative.enabled else 0

    typer.echo("ravn daemon started.")
    typer.echo(f"  Channels: {channels_str}")
    typer.echo(f"  Triggers: {triggers_str}")
    typer.echo(
        f"  Drive loop: {'running' if settings.initiative.enabled else 'disabled'}"
        + (f" (max {concurrent} concurrent tasks)" if settings.initiative.enabled else "")
    )
    typer.echo("Press Ctrl+C to stop.")

    if not tasks:
        typer.echo("No channels or triggers enabled — daemon has nothing to do.", err=True)
        return

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    except KeyboardInterrupt:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await event_publisher.close()
        await _shutdown_mcp(mcp_manager)


def _wire_triggers(drive_loop: Any, initiative: InitiativeConfig) -> None:
    """Instantiate trigger adapters from config and register them on drive_loop."""
    from ravn.domain.models import OutputMode

    for tc in initiative.triggers:
        output_mode = OutputMode(tc.output_mode) if tc.output_mode else OutputMode.SILENT
        try:
            if tc.type == "cron":
                from ravn.adapters.triggers.cron import CronJob, CronTrigger

                job = CronJob(
                    name=tc.name,
                    schedule=tc.schedule,
                    context=tc.context,
                    output_mode=output_mode,
                    persona=tc.persona or None,
                    priority=tc.priority,
                )
                drive_loop.register_trigger(CronTrigger(jobs=[job]))

            elif tc.type == "sleipnir_event":
                from ravn.adapters.triggers.sleipnir import SleipnirEventTrigger

                drive_loop.register_trigger(
                    SleipnirEventTrigger(
                        name=tc.name,
                        pattern=tc.pattern,
                        context_template=tc.context_template,
                        output_mode=output_mode,
                        persona=tc.persona or None,
                        priority=tc.priority,
                        amqp_url=tc.amqp_url,
                        exchange=tc.exchange,
                        retry_delay_seconds=tc.retry_delay_seconds,
                    )
                )

            elif tc.type == "condition_poll":
                logger.warning(
                    "condition_poll trigger %r requires a sensor_agent_factory — skipping",
                    tc.name,
                )

        except Exception as exc:
            logger.error("Failed to wire trigger %r: %s", tc.name, exc)


@app.command()
def peers(
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
    verbose: bool = typer.Option(
        False, "--verbose", "-v", help="Show address, latency, task_count, last_seen."
    ),
    scan: bool = typer.Option(
        False, "--scan", help="Force a fresh mDNS/K8s scan before displaying."
    ),
) -> None:
    """List verified flock members with persona, capabilities, and status.

    \b
    Examples:
      ravn peers               — list verified peers
      ravn peers --verbose     — include address, latency, task_count
      ravn peers --scan        — force a fresh network scan first
    """
    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    _configure_logging(settings)
    asyncio.run(_run_peers(settings, verbose=verbose, force_scan=scan))


async def _run_peers(settings: Settings, *, verbose: bool, force_scan: bool) -> None:
    """Build a discovery adapter, optionally scan, and print the peer table."""
    import importlib

    from ravn.adapters.discovery._identity import (
        load_or_create_peer_id,
        load_or_create_realm_key,
        realm_id_from_key,
    )
    from ravn.domain.models import RavnIdentity

    peer_id = load_or_create_peer_id()
    realm_key = load_or_create_realm_key()
    realm_id = realm_id_from_key(realm_key)

    import importlib.metadata

    try:
        version = importlib.metadata.version("ravn")
    except Exception:
        version = "0.0.0"

    identity = RavnIdentity(
        peer_id=peer_id,
        realm_id=realm_id,
        persona=settings.agent.system_prompt[:30] if settings.agent.system_prompt else "ravn",
        capabilities=[],
        permission_mode=settings.permission.mode,
        version=version,
    )

    adapter_name = settings.discovery.adapter
    discovery = _build_discovery_adapter(adapter_name, settings, identity)
    if discovery is None:
        typer.echo("No discovery adapter configured.", err=True)
        return

    await discovery.start()

    if force_scan:
        candidates = await discovery.scan()
        typer.echo(f"Scan found {len(candidates)} candidate(s).")
        for c in candidates:
            if c.peer_id not in discovery.peers():
                peer = await discovery.handshake(c)
                if peer is not None:
                    typer.echo(f"  Handshook with {c.peer_id}")

    verified = discovery.peers()
    if not verified:
        typer.echo("No verified flock members found.")
        await discovery.stop()
        return

    typer.echo(f"Flock members ({len(verified)}):")
    for pid, peer in sorted(verified.items()):
        caps = ", ".join(peer.capabilities) if peer.capabilities else "—"
        line = f"  {pid[:8]}  {peer.persona:<20} [{peer.status}]  caps={caps}"
        if verbose:
            rep = peer.rep_address or "—"
            pub = peer.pub_address or "—"
            latency = f"{peer.latency_ms:.1f}ms" if peer.latency_ms is not None else "—"
            line += f"\n    rep={rep}  pub={pub}  latency={latency}  tasks={peer.task_count}"
            line += f"  last_seen={peer.last_seen.isoformat()}"
        typer.echo(line)

    await discovery.stop()


def _build_discovery_adapter(name: str, settings: Settings, identity: Any) -> Any:
    """Instantiate a discovery adapter by name."""
    if name == "mdns":
        from ravn.adapters.discovery.mdns import MdnsDiscoveryAdapter

        return MdnsDiscoveryAdapter(config=settings.discovery, own_identity=identity)

    if name == "sleipnir":
        from ravn.adapters.discovery.sleipnir import SleipnirDiscoveryAdapter

        return SleipnirDiscoveryAdapter(
            config=settings.discovery,
            sleipnir_config=settings.sleipnir,
            own_identity=identity,
        )

    if name == "k8s":
        from ravn.adapters.discovery.k8s import K8sDiscoveryAdapter

        return K8sDiscoveryAdapter(config=settings.discovery, own_identity=identity)

    if name == "composite":
        from ravn.adapters.discovery.composite import CompositeDiscoveryAdapter
        from ravn.adapters.discovery.mdns import MdnsDiscoveryAdapter
        from ravn.adapters.discovery.sleipnir import SleipnirDiscoveryAdapter

        backends: list[Any] = [
            MdnsDiscoveryAdapter(config=settings.discovery, own_identity=identity),
            SleipnirDiscoveryAdapter(
                config=settings.discovery,
                sleipnir_config=settings.sleipnir,
                own_identity=identity,
            ),
        ]
        return CompositeDiscoveryAdapter(backends=backends)

    logger.warning("Unknown discovery adapter %r — defaulting to mdns", name)
    from ravn.adapters.discovery.mdns import MdnsDiscoveryAdapter

    return MdnsDiscoveryAdapter(config=settings.discovery, own_identity=identity)


def main() -> None:
    app()


def gateway_main() -> None:
    gateway_app()


def evolve_main() -> None:
    evolve_app()
