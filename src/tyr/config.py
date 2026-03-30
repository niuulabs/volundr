"""Configuration settings for Tyr.

Configuration is loaded from YAML, with environment variables overriding.

Config file locations (first found wins):
- ./tyr.yaml
- /etc/tyr/config.yaml

Environment variable override format:
- Use double underscore for nested fields: DATABASE__HOST
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

CONFIG_PATHS = [
    Path("./tyr.yaml"),
    Path("/etc/tyr/config.yaml"),
]


class DatabaseConfig(BaseModel):
    """PostgreSQL database configuration."""

    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    user: str = Field(default="tyr")
    password: str = Field(default="tyr")
    name: str = Field(default="tyr")
    min_pool_size: int = Field(default=5)
    max_pool_size: int = Field(default=20)

    @property
    def dsn(self) -> str:
        """Return PostgreSQL connection string."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="info")
    format: str = Field(default="text")


class VolundrConfig(BaseModel):
    """Volundr API connection configuration."""

    url: str = Field(default="http://localhost:8000")


class CredentialStoreConfig(BaseModel):
    """Dynamic credential store adapter configuration."""

    adapter: str = Field(
        default="niuu.adapters.memory_credential_store.MemoryCredentialStore",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)


class AIModelConfig(BaseModel):
    """Available AI model — configured via Helm values.

    Mirrors niuu.domain.models.AIModelConfig but as a pydantic model
    for settings deserialization.
    """

    id: str
    name: str


class ReviewConfig(BaseModel):
    """Confidence deltas for raid review actions."""

    confidence_delta_approved: float = Field(default=0.15)
    confidence_delta_rejected: float = Field(default=-0.20)
    confidence_delta_retry: float = Field(default=-0.05)
    initial_confidence: float = Field(
        default=0.5,
        description="Starting confidence score for newly committed sagas, phases, and raids.",
    )
    auto_approve_threshold: float = Field(
        default=0.80,
        description="Confidence threshold above which raids are auto-merged.",
    )
    max_retries: int = Field(
        default=3,
        description="Maximum auto-retries before escalation to human review.",
    )
    scope_breach_threshold: float = Field(
        default=0.30,
        description="Fraction of undeclared changed files that flags a scope breach.",
    )
    confidence_delta_ci_pass: float = Field(default=0.30)
    confidence_delta_ci_fail: float = Field(default=-0.30)
    confidence_delta_mergeable: float = Field(default=0.10)
    confidence_delta_conflict: float = Field(default=-0.20)
    confidence_delta_scope_breach: float = Field(default=-0.25)
    confidence_delta_retry_multiplier: float = Field(
        default=-0.05,
        description="Per-retry confidence penalty (multiplied by retry_count).",
    )
    reviewer_session_enabled: bool = Field(
        default=True,
        description="Spawn an LLM-powered reviewer session for raids in REVIEW state.",
    )
    reviewer_model: str = Field(
        default="claude-opus-4-6",
        description="AI model for reviewer sessions.",
    )
    reviewer_profile: str = Field(
        default="reviewer",
        description="Volundr profile name for reviewer sessions.",
    )
    reviewer_confidence_weight: float = Field(
        default=0.60,
        description="Weight applied to the reviewer's confidence score (0.0–1.0).",
    )
    reviewer_spawn_bonus: float = Field(
        default=0.1,
        description="Small confidence bonus applied when a reviewer session is spawned.",
    )
    max_review_rounds: int = Field(
        default=6,
        ge=6,
        description="Maximum review rounds before escalating. Minimum 6.",
    )
    reviewer_system_prompt: str = Field(
        default=(
            "You are a senior code reviewer for the Niuu platform. You do not just check\n"
            "rules — you READ the code, UNDERSTAND it, and provide substantive feedback\n"
            "on quality, design, and correctness.\n"
            "\n"
            "## Setup\n"
            "\n"
            "1. Read CLAUDE.md and `.claude/rules/` — they are the authoritative project rules.\n"
            "2. Ensure tools are available:\n"
            "   - `gh` (GitHub CLI): check `~/` or PATH. Install if missing (`brew install gh`).\n"
            "   - Linear MCP server may be available. If not, use LINEAR_API_KEY env.\n"
            "\n"
            "## Review Process\n"
            "\n"
            "Read the full diff and review EVERY changed file across three dimensions:\n"
            "\n"
            "### 1. Code Reuse\n"
            "- Search the codebase for existing utilities that could replace newly written code.\n"
            "- Flag new functions that duplicate existing functionality — suggest the existing one.\n"
            "- Flag inline logic that could use an existing utility (string manipulation, path\n"
            "  handling, type guards, etc.).\n"
            "\n"
            "### 2. Code Quality\n"
            "- **Redundant state**: state duplicating other state, values that could be derived.\n"
            "- **Parameter sprawl**: adding params instead of restructuring.\n"
            "- **Copy-paste with variation**: near-duplicate blocks that should be unified.\n"
            "- **Leaky abstractions**: exposing internals, breaking abstraction boundaries.\n"
            "- **Stringly-typed code**: raw strings where constants or enums exist.\n"
            "- **Unnecessary comments**: comments explaining WHAT (delete), keep only WHY.\n"
            "- **Architecture violations**: wrong layer imports, missing port/adapter separation.\n"
            "\n"
            "### 3. Efficiency\n"
            "- **Unnecessary work**: redundant computations, repeated reads, N+1 patterns.\n"
            "- **Missed concurrency**: independent operations run sequentially.\n"
            "- **Hot-path bloat**: blocking work on startup or per-request paths.\n"
            "- **Memory**: unbounded data structures, missing cleanup.\n"
            "- **Overly broad operations**: reading entire files when a portion suffices.\n"
            "\n"
            "### 4. Correctness & Safety\n"
            "- Verify acceptance criteria are met.\n"
            "- Check the PR targets the feature branch, NOT `main`.\n"
            "- Check `codecov/patch` — it is a hard gate, not advisory.\n"
            "- Look for edge cases, error handling gaps, and security issues.\n"
            "- Verify conventional commit messages.\n"
            "\n"
            "## Every Finding Must Be Addressed\n"
            "\n"
            "Every finding — bugs, quality issues, reuse opportunities, efficiency\n"
            "improvements — is blocking. If you find it worth mentioning, the working\n"
            "session must fix it before the PR can merge.\n"
            "\n"
            "For each finding, suggest a specific fix — don't just say what's wrong,\n"
            "say how to fix it. Reference file names and line numbers.\n"
            "\n"
            "## Confidence Scoring\n"
            "\n"
            "| Score | Meaning |\n"
            "|-------|---------|\n"
            "| 1.0 | No findings — clean code, ready to merge. |\n"
            "| 0.80–0.99 | Minor findings — fixable in one round. |\n"
            "| 0.50–0.79 | Significant findings — needs rework. |\n"
            "| <0.50 | Fundamental issues — architecture or design problems. |\n"
            "\n"
            "Only approve (`approved: true`) when `findings` is empty.\n"
            "\n"
            "## Response Format\n"
            "\n"
            "```json\n"
            "{\n"
            '  "confidence": <0.0–1.0>,\n'
            '  "approved": <true only if findings is empty and PR is merged>,\n'
            '  "summary": "<one-line summary of the review>",\n'
            '  "findings": [\n'
            '    "file:line — [category] description and suggested fix"\n'
            "  ]\n"
            "}\n"
            "```\n"
            "\n"
            "Categories: `[bug]`, `[security]`, `[architecture]`, `[reuse]`,\n"
            "`[quality]`, `[efficiency]`, `[test]`, `[style]`."
        ),
        description="System prompt for reviewer sessions.",
    )
    reviewer_initial_prompt_template: str = Field(
        default=(
            "## Review Request\n"
            "\n"
            "**Ticket**: {tracker_id}\n"
            "**Raid**: {raid_name}\n"
            "**Description**: {raid_description}\n"
            "\n"
            "{acceptance_criteria_section}"
            "{pr_section}"
            "{changed_files_section}"
            "{diff_summary_section}"
            "## Instructions\n"
            "\n"
            "1. Read CLAUDE.md and `.claude/rules/` for project conventions.\n"
            "2. Read the full diff — every changed file, not just the summary.\n"
            "3. For each changed file, also read the SURROUNDING code (not just the diff\n"
            "   lines) to understand context and spot missed reuse opportunities.\n"
            "4. Search the codebase for existing utilities that overlap with new code.\n"
            "5. Verify acceptance criteria are met.\n"
            "6. Verify PR targets the feature branch, not `main`.\n"
            "7. Check CI status — `codecov/patch` is a hard gate (85%).\n"
            "\n"
            "{review_loop_section}"
            "## Merging\n"
            "\n"
            "When satisfied (no findings remaining),\n"
            "merge the PR before outputting your assessment:\n"
            "\n"
            "```bash\n"
            "gh pr merge --squash --delete-branch\n"
            "```\n"
            "\n"
            "If `gh` is not found, install it (`brew install gh` or `apt install gh`).\n"
            "If merge fails, set approved=false and explain why.\n"
            "\n"
            "## Final Output\n"
            "\n"
            "```json\n"
            "{{\n"
            '  "confidence": <score>,\n'
            '  "approved": <true only if findings is empty and PR merged>,\n'
            '  "summary": "<one line>",\n'
            '  "findings": ["file:line — [category] description and fix"]\n'
            "}}\n"
            "```"
        ),
        description=(
            "Template for the reviewer's initial prompt. Dynamic sections: "
            "{tracker_id}, {raid_name}, {raid_description}, "
            "{acceptance_criteria_section}, {pr_section}, {changed_files_section}, "
            "{diff_summary_section}, {review_loop_section}."
        ),
    )


class GitConfig(BaseModel):
    """Git provider configuration."""

    token: str = Field(default="")


class PlannerConfig(BaseModel):
    """Planning session configuration."""

    planner_system_prompt: str = Field(
        default=(
            "You are a saga planning assistant for the Niuu platform.\n"
            "\n"
            "Help the user decompose a feature specification into phases and raids\n"
            "(discrete, independently mergeable tasks).\n"
            "\n"
            "## Sizing\n"
            "\n"
            "Use t-shirt sizing for raids:\n"
            "- **S** (Small): well-bounded, single file or function change\n"
            "- **M** (Medium): a few files, clear scope, independently testable\n"
            "- **L** (Large): too big — MUST be decomposed into its own phase\n"
            "\n"
            "Anything larger than M should become its own milestone (phase) with\n"
            "smaller raids inside. Prefer many small, independent tasks.\n"
            "\n"
            "## Constraints\n"
            "\n"
            "- Each raid must be independently testable and mergeable.\n"
            "- Phases run sequentially. Within a phase, raids run in parallel\n"
            "  unless `depends_on` declares an ordering.\n"
            "- Order phases: foundations first, features next, polish last.\n"
            "- Every raid needs acceptance criteria and `declared_files`.\n"
            "\n"
            "## Process\n"
            "\n"
            "1. Ask clarifying questions if the spec is ambiguous.\n"
            "2. Propose a phased breakdown with t-shirt sized raids.\n"
            "3. Iterate with the user until they are satisfied.\n"
            "4. When the user says 'finalize', output the structure as JSON.\n"
            "\n"
            "Repository: {repo}\n"
            "Base branch: {base_branch}\n"
            "Specification:\n{spec}"
        ),
        description=(
            "System prompt for the interactive planning session. "
            "Available placeholders: {repo}, {base_branch}, {spec}."
        ),
    )
    finalize_prompt: str = Field(
        default=(
            "Please finalize the plan now. Output the saga structure as a JSON code block:\n"
            "\n"
            "```json\n"
            "{\n"
            '  "name": "Saga Name",\n'
            '  "phases": [\n'
            "    {\n"
            '      "name": "Phase 1",\n'
            '      "raids": [\n'
            "        {\n"
            '          "name": "Raid name",\n'
            '          "description": "What this raid does",\n'
            '          "acceptance_criteria": ["criterion 1", "criterion 2"],\n'
            '          "declared_files": ["src/path/file.py"],\n'
            '          "size": "S",\n'
            '          "depends_on": ["Other raid name"]\n'
            "        }\n"
            "      ]\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "```\n"
            "\n"
            "Requirements:\n"
            "- Every raid needs name, description, and acceptance criteria.\n"
            "- `declared_files`: likely files the raid will touch.\n"
            "- `size`: S or M. If L, split it into its own phase.\n"
            "- `depends_on`: optional, use when a raid waits for another (by name, same phase)."
        ),
        description="Prompt injected when the user clicks Finalize Plan.",
    )


class DispatchConfig(BaseModel):
    """Dispatcher configuration."""

    default_system_prompt: str = Field(default="")
    default_model: str = Field(default="claude-sonnet-4-6")
    dispatch_prompt_template: str = Field(
        default=(
            "# Task: {identifier} — {title}\n"
            "\n"
            "{description}\n"
            "\n"
            "Repository: {repo}\n"
            "Feature branch: {feature_branch}\n"
            "Create a working branch for your changes: `{raid_branch}`\n"
            "\n"
            "## Before You Start\n"
            "\n"
            "1. Read the CLAUDE.md and any `.claude/rules/` files — they contain project\n"
            "   conventions you MUST follow.\n"
            "2. Explore the existing codebase in the areas you will change.\n"
            "3. Understand the architecture before writing code.\n"
            "4. Ensure required tools are available:\n"
            "   - `gh` (GitHub CLI) — check `~/` or install via `brew install gh` / `apt install gh`\n"
            "   - `git` — must be configured with push access\n"
            "   - If a tool is missing, install it before proceeding.\n"
            "\n"
            "## Completion Requirements\n"
            "\n"
            "1. **Update the issue tracker**: Set ticket `{identifier}` to **In Progress**.\n"
            "2. **Implement the task**: Write code and tests, ensure coverage >= 85%.\n"
            "3. **Commit your changes**: Use conventional commits (see CLAUDE.md).\n"
            "4. **Create a PR against `{feature_branch}`** (NOT `main`): include a summary\n"
            "   of all changes in the PR description.\n"
            "5. **Wait for CI**: All checks must pass (tests, lint, coverage).\n"
            "   `codecov/patch` is a hard gate — if it fails, fix coverage and push again.\n"
            "6. **Update the issue tracker**: Add a comment on `{identifier}` with a summary\n"
            "   of what was done and a link to the PR.\n"
            "\n"
            "**Do NOT stop until the PR is created and CI is green.**"
        ),
        description=(
            "Template for the initial prompt sent to coding sessions. "
            "Available placeholders: {identifier}, {title}, {description}, "
            "{repo}, {feature_branch}, {raid_branch}. "
            "Override in tyr.yaml or Helm values."
        ),
    )


class CerbosConfig(BaseModel):
    """Cerbos authorization service configuration."""

    url: str = Field(default="http://localhost:3592")


class PATConfig(BaseModel):
    """Personal access token configuration (matches Volundr's PATConfig)."""

    token_issuer_adapter: str = Field(
        default="niuu.adapters.memory_token_issuer.MemoryTokenIssuer",
        description="Fully-qualified class path for the token issuer adapter.",
    )
    token_issuer_kwargs: dict = Field(
        default_factory=dict,
        description="Kwargs passed to the token issuer adapter constructor.",
    )
    ttl_days: int = Field(
        default=365,
        description="Default PAT lifetime in days.",
    )
    revocation_cache_ttl: float = Field(
        default=300.0,
        description="Seconds to cache valid-token lookups before re-checking the DB.",
    )
    revoked_cache_ttl: float = Field(
        default=60.0,
        description="Seconds to cache revoked-token lookups (shorter for fast propagation).",
    )


class AuthConfig(BaseModel):
    """Authentication configuration."""

    allow_anonymous_dev: bool = Field(
        default=False,
        description=(
            "When True, requests without auth headers fall back to a default developer "
            "identity. Must be False in production."
        ),
    )


class TelegramConfig(BaseModel):
    """Telegram bot configuration for deeplink setup and webhook commands."""

    bot_username: str = Field(default="TyrBot")
    bot_token: str = Field(
        default="",
        description="Telegram Bot API token — required for webhook replies.",
    )
    webhook_secret: str = Field(
        default="",
        description=(
            "Secret token set when registering the webhook with Telegram. "
            "Telegram sends it as X-Telegram-Bot-Api-Secret-Token header. "
            "When non-empty, requests without a matching header are rejected with 403."
        ),
    )
    reply_timeout: float = Field(
        default=10.0,
        description="Timeout in seconds for Telegram Bot API reply calls.",
    )
    hmac_key: str = Field(default="")
    hmac_signature_length: int = Field(
        default=32,
        description="Number of hex characters to use from the HMAC-SHA256 signature.",
    )


class LLMConfig(BaseModel):
    """LLM adapter configuration (dynamic adapter pattern)."""

    adapter: str = Field(
        default="tyr.adapters.bifrost.BifrostAdapter",
        description="Fully-qualified class path for the LLM adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)
    default_model: str = Field(default="claude-sonnet-4-6")
    min_estimate_hours: float = Field(default=2.0)
    max_estimate_hours: float = Field(default=8.0)
    decomposition_system_prompt: str = Field(
        default="",
        description=(
            "System prompt for LLM-powered saga decomposition. "
            "Available placeholders: {repo}, {spec}. "
            "When empty, the built-in DECOMPOSITION_PROMPT in bifrost.py is used."
        ),
    )


class TrackerConfig(BaseModel):
    """Tracker adapter configuration."""

    cache_ttl_seconds: float = Field(default=30.0)
    rate_limit_max_retries: int = Field(default=3)


class WatcherConfig(BaseModel):
    """Raid completion watcher configuration."""

    enabled: bool = Field(default=True)
    poll_interval: float = Field(default=30.0, description="Seconds between polls.")
    batch_size: int = Field(default=10, description="Max concurrent session checks.")
    chronicle_on_complete: bool = Field(
        default=True, description="Fetch chronicle summary on completion."
    )
    idle_threshold: float = Field(
        default=30.0,
        description="Seconds of idle before considering work complete.",
    )
    completion_check_delay: float = Field(
        default=5.0,
        description="Seconds to wait after idle before evaluating completion (debounce).",
    )
    require_pr: bool = Field(
        default=False,
        description="If true, PR must exist for completion.",
    )
    require_ci: bool = Field(
        default=False,
        description="If true, CI must pass for completion.",
    )
    confidence_base: float = Field(
        default=0.5,
        description="Base confidence score when completion criteria are met.",
    )
    confidence_pr_bonus: float = Field(
        default=0.2,
        description="Confidence bonus when a PR exists.",
    )
    confidence_ci_bonus: float = Field(
        default=0.2,
        description="Confidence bonus when CI has passed.",
    )
    confidence_idle_bonus: float = Field(
        default=0.1,
        description="Confidence bonus for extended idle beyond threshold.",
    )
    reconnect_delay: float = Field(
        default=5.0,
        description="Seconds to wait before reconnecting after SSE subscription failure.",
    )


class EventBusConfig(BaseModel):
    """Event bus adapter configuration (dynamic adapter pattern)."""

    adapter: str = Field(
        default="tyr.adapters.memory_event_bus.InMemoryEventBus",
        description="Fully-qualified class path for the EventBus adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)


class NotificationConfig(BaseModel):
    """Notification service configuration."""

    enabled: bool = Field(default=True)
    confidence_threshold: float = Field(
        default=0.3,
        description="Notify when raid confidence drops below this value.",
    )


class EventsConfig(BaseModel):
    """SSE event stream configuration."""

    max_sse_clients: int = Field(default=10)
    keepalive_interval: float = Field(default=15.0)
    activity_log_size: int = Field(
        default=100,
        description="Number of events retained in the dispatcher activity ring buffer.",
    )


class Settings(BaseSettings):
    """Application settings.

    Loads configuration from YAML file with environment variable overrides.

    YAML file locations (first found wins):
    - ./tyr.yaml
    - /etc/tyr/config.yaml

    Environment variable overrides use double underscore for nesting:
    - DATABASE__HOST=myhost -> settings.database.host
    """

    model_config = SettingsConfigDict(
        yaml_file=CONFIG_PATHS,
        yaml_file_encoding="utf-8",
        env_nested_delimiter="__",
    )

    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    volundr: VolundrConfig = Field(default_factory=VolundrConfig)
    ai_models: list[AIModelConfig] = Field(
        default_factory=lambda: [
            AIModelConfig(id="claude-opus-4-6", name="Opus 4.6"),
            AIModelConfig(id="claude-sonnet-4-6", name="Sonnet 4.6"),
            AIModelConfig(id="claude-haiku-4-5-20251001", name="Haiku 4.5"),
        ]
    )
    git: GitConfig = Field(default_factory=GitConfig)
    review: ReviewConfig = Field(default_factory=ReviewConfig)
    tracker: TrackerConfig = Field(default_factory=TrackerConfig)
    dispatch: DispatchConfig = Field(default_factory=DispatchConfig)
    planner: PlannerConfig = Field(default_factory=PlannerConfig)
    credential_store: CredentialStoreConfig = Field(default_factory=CredentialStoreConfig)
    pat: PATConfig = Field(default_factory=PATConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    cerbos: CerbosConfig = Field(default_factory=CerbosConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    watcher: WatcherConfig = Field(default_factory=WatcherConfig)
    event_bus: EventBusConfig = Field(default_factory=EventBusConfig)
    events: EventsConfig = Field(default_factory=EventsConfig)
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)
    notification: NotificationConfig = Field(default_factory=NotificationConfig)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Customize settings sources.

        Order (first wins):
        1. init_settings - explicit constructor arguments
        2. env_settings - environment variables
        3. yaml - YAML config file
        4. file_secret_settings - /run/secrets files
        """
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls),
            file_secret_settings,
        )
