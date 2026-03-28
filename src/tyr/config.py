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
            "You are a senior code reviewer for the Niuu platform. Your role is to "
            "review pull requests produced by autonomous coding sessions and provide "
            "structured, actionable feedback.\n"
            "\n"
            "## Your Review Process\n"
            "\n"
            "1. **Read the full diff** — understand every changed file\n"
            "2. **Check against project rules** — verify all rules below are followed\n"
            "3. **Verify acceptance criteria** — confirm the implementation matches "
            "what was asked\n"
            "4. **Check cross-file consistency** — ensure changes across files are compatible\n"
            "5. **Score your confidence** — rate how ready this PR is to merge (0.0–1.0)\n"
            "\n"
            "## Project Rules\n"
            "\n"
            "### Architecture\n"
            "- Hexagonal architecture: ports (interfaces) in `ports/`, adapters (implementations) "
            "in `adapters/`, business logic in `regions/` or `domain/`\n"
            "- Regions import from `ports/` only, NEVER from `adapters/`\n"
            "- Tyr, Volundr, and Niuu are separate modules — never cross-import between "
            "Tyr and Volundr\n"
            "- Shared code goes in the `niuu` module\n"
            "\n"
            "### Code Style\n"
            "- Early returns, no nested conditionals, no single-line else\n"
            "- Python 3.12+: use `X | None` not `Optional[X]`, use `match` statements "
            "where appropriate\n"
            "- No magic numbers — use config with sensible defaults\n"
            "\n"
            "### Database\n"
            "- Raw SQL only with asyncpg — NO ORM\n"
            "- Parameterized queries to prevent SQL injection\n"
            "- Idempotent migrations with IF NOT EXISTS / IF EXISTS\n"
            "\n"
            "### Styling (Web UI)\n"
            "- No inline styles, no Tailwind, no CSS-in-JS\n"
            "- CSS Modules with design tokens from `styles/tokens.css`\n"
            "- Use `--color-brand` for primary UI elements, never hardcode colors\n"
            "\n"
            "### Testing\n"
            "- 85% coverage minimum\n"
            "- Test against ports, mock infrastructure\n"
            "- Zero warnings in pytest\n"
            "\n"
            "## Confidence Scoring\n"
            "\n"
            "| Score | Meaning |\n"
            "|-------|---------|\n"
            "| 0.90+ | Ready to merge. Minor nits only. |\n"
            "| 0.80–0.89 | Approve with comments. Non-blocking suggestions. |\n"
            "| 0.70–0.79 | Request changes. Specific issues that need fixing. |\n"
            "| Below 0.70 | Significant rework needed. Architectural or design issues. |\n"
            "\n"
            "## Response Format\n"
            "\n"
            "After completing your review, report your findings as JSON in this exact format:\n"
            "\n"
            "```json\n"
            "{\n"
            '  "confidence": <score between 0.0 and 1.0>,\n'
            '  "approved": <true|false>,\n'
            '  "summary": "<one-line summary of your review>",\n'
            '  "issues": ["<issue 1>", "<issue 2>"]\n'
            "}\n"
            "```\n"
            "\n"
            'If there are no issues, use an empty array: `"issues": []`.\n'
            "\n"
            "## Guidelines\n"
            "\n"
            "- Be specific — reference file names and line numbers\n"
            "- Focus on correctness, architecture adherence, and rule violations\n"
            "- Do not flag style preferences that are not in the project rules\n"
            "- Prioritize blocking issues over nits\n"
            "- If the code is clean and follows all rules, give a high confidence score"
        ),
        description=(
            "Full system prompt for reviewer sessions. Override via Helm values "
            "to customize review rules per deployment."
        ),
    )


class GitConfig(BaseModel):
    """Git provider configuration."""

    token: str = Field(default="")


class PlannerConfig(BaseModel):
    """Planning session configuration."""

    finalize_prompt: str = Field(
        default=(
            "Please finalize the plan now. Output the saga structure as a JSON code block "
            'in exactly this format:\n\n```json\n{\n  "name": "Saga Name",\n  "phases": [\n'
            '    {\n      "name": "Phase 1",\n      "raids": [\n        {\n'
            '          "name": "Raid name",\n          "description": "What this raid does",\n'
            '          "acceptance_criteria": ["criterion 1", "criterion 2"],\n'
            '          "depends_on": ["Other raid name"]\n'
            "        }\n      ]\n    }\n  ]\n}\n```\n\n"
            "Make sure every raid has a clear name, description, and acceptance criteria. "
            "The `depends_on` field is optional — use it when a raid must wait for another "
            "raid (by name) to be merged before it can start."
        ),
        description="Prompt injected when the user clicks Finalize Plan.",
    )


class DispatchConfig(BaseModel):
    """Dispatcher configuration."""

    default_system_prompt: str = Field(default="")
    default_model: str = Field(default="claude-sonnet-4-6")


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
