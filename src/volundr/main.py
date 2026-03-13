"""Application factory for Volundr API."""

import asyncio
import logging
import os
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from volundr.adapters.inbound.rest import create_router
from volundr.adapters.inbound.rest_credentials import create_credentials_router
from volundr.adapters.inbound.rest_events import create_events_router
from volundr.adapters.inbound.rest_git import create_git_router
from volundr.adapters.inbound.rest_integrations import create_integrations_router
from volundr.adapters.inbound.rest_presets import create_presets_router
from volundr.adapters.inbound.rest_profiles import create_profiles_router
from volundr.adapters.inbound.rest_prompts import create_prompts_router
from volundr.adapters.inbound.rest_resources import create_resources_router
from volundr.adapters.inbound.rest_secrets import create_secrets_router
from volundr.adapters.inbound.rest_tenants import create_tenants_router
from volundr.adapters.inbound.rest_tracker import create_tracker_router
from volundr.adapters.outbound.broadcaster import InMemoryEventBroadcaster
from volundr.adapters.outbound.config_mcp_servers import ConfigMCPServerProvider
from volundr.adapters.outbound.config_profiles import ConfigProfileProvider
from volundr.adapters.outbound.config_templates import ConfigTemplateProvider
from volundr.adapters.outbound.git_registry import create_git_registry
from volundr.adapters.outbound.memory_integrations import InMemoryIntegrationRepository
from volundr.adapters.outbound.memory_secret_repo import InMemorySecretRepository
from volundr.adapters.outbound.memory_secrets import InMemorySecretManager
from volundr.adapters.outbound.pg_event_sink import PostgresEventSink
from volundr.adapters.outbound.postgres import PostgresSessionRepository
from volundr.adapters.outbound.postgres_chronicles import PostgresChronicleRepository
from volundr.adapters.outbound.postgres_presets import PostgresPresetRepository
from volundr.adapters.outbound.postgres_prompts import PostgresPromptRepository
from volundr.adapters.outbound.postgres_stats import PostgresStatsRepository
from volundr.adapters.outbound.postgres_tenants import PostgresTenantRepository
from volundr.adapters.outbound.postgres_timeline import PostgresTimelineRepository
from volundr.adapters.outbound.postgres_tokens import PostgresTokenTracker
from volundr.adapters.outbound.postgres_users import PostgresUserRepository
from volundr.adapters.outbound.pricing import HardcodedPricingProvider
from volundr.config import LoggingConfig, Settings
from volundr.domain.ports import SessionContributor
from volundr.domain.services import (
    ChronicleService,
    GitWorkflowService,
    PresetService,
    PromptService,
    RepoService,
    SessionService,
    StatsService,
    TenantService,
    TokenService,
    TrackerService,
)
from volundr.domain.services.event_ingestion import EventIngestionService
from volundr.domain.services.profile import ForgeProfileService
from volundr.domain.services.template import WorkspaceTemplateService
from volundr.domain.services.workspace import WorkspaceService
from volundr.infrastructure.database import database_pool
from volundr.utils import import_class

# Interval for periodic stats and heartbeat broadcasts (seconds)
BROADCAST_INTERVAL = 30

logger = logging.getLogger(__name__)


def configure_logging(config: LoggingConfig | None = None) -> None:
    """Configure logging from settings.

    Args:
        config: Logging configuration. If None, uses defaults from
            LoggingConfig which reads from LOG_LEVEL and LOG_FORMAT
            environment variables.
    """
    if config is None:
        config = LoggingConfig()

    level_name = config.level.upper()
    log_format = config.format.lower()

    # Map level name to logging constant
    level = getattr(logging, level_name, logging.INFO)

    # Choose format based on config
    if log_format == "json":
        # Simple JSON-ish format for structured logging
        fmt = (
            '{"time":"%(asctime)s","level":"%(levelname)s",'
            '"logger":"%(name)s","message":"%(message)s"}'
        )
    else:
        fmt = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # Configure root logger
    logging.basicConfig(
        level=level,
        format=fmt,
        stream=sys.stderr,
        force=True,  # Override any existing configuration
    )

    logging.getLogger(__name__).info(
        "Logging configured: level=%s, format=%s",
        level_name,
        log_format,
    )


def _resolve_secret_kwargs(
    kwargs: dict[str, Any],
    secret_kwargs_env: dict[str, str],
) -> dict[str, Any]:
    """Merge secret kwargs from environment variables into adapter kwargs.

    secret_kwargs_env maps kwarg names to env var names. Values from env
    vars override any same-named keys already in kwargs.
    """
    if not secret_kwargs_env:
        return kwargs
    resolved = dict(kwargs)
    for kwarg_name, env_var in secret_kwargs_env.items():
        value = os.environ.get(env_var)
        if value is not None:
            resolved[kwarg_name] = value
    return resolved


def _create_pod_manager(settings: Settings) -> "PodManager":  # noqa: F821
    """Create the PodManager adapter from dynamic config."""
    pm_cfg = settings.pod_manager
    cls = import_class(pm_cfg.adapter)
    kwargs = _resolve_secret_kwargs(pm_cfg.kwargs, pm_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Pod manager: %s", pm_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_identity_adapter(
    settings: Settings,
    user_repository,
    storage=None,
) -> "IdentityPort":  # noqa: F821
    """Create the IdentityPort adapter from dynamic config."""
    id_cfg = settings.identity
    kwargs = _resolve_secret_kwargs(id_cfg.kwargs, id_cfg.secret_kwargs_env)
    kwargs = dict(kwargs)
    kwargs["user_repository"] = user_repository
    kwargs["role_mapping"] = settings.identity.role_mapping
    if storage is not None:
        kwargs["storage"] = storage
    cls = import_class(id_cfg.adapter)
    instance = cls(**kwargs)
    logger.info("Identity adapter: %s", id_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_authorization_adapter(settings: Settings) -> "AuthorizationPort":  # noqa: F821
    """Create the AuthorizationPort adapter from dynamic config."""
    az_cfg = settings.authorization
    cls = import_class(az_cfg.adapter)
    kwargs = _resolve_secret_kwargs(az_cfg.kwargs, az_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Authorization adapter: %s", az_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_credential_store(settings: Settings) -> "CredentialStorePort":  # noqa: F821
    """Create the CredentialStorePort adapter from dynamic config."""
    cs_cfg = settings.credential_store
    cls = import_class(cs_cfg.adapter)
    kwargs = _resolve_secret_kwargs(cs_cfg.kwargs, cs_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Credential store: %s", cs_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_gateway_adapter(settings: Settings) -> "GatewayPort":  # noqa: F821
    """Create the GatewayPort adapter from dynamic config."""
    gw_cfg = settings.gateway
    cls = import_class(gw_cfg.adapter)
    kwargs = _resolve_secret_kwargs(gw_cfg.kwargs, gw_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Gateway adapter: %s", gw_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_secret_injection_adapter(settings: Settings) -> "SecretInjectionPort":  # noqa: F821
    """Create the SecretInjectionPort adapter from dynamic config."""
    si_cfg = settings.secret_injection
    cls = import_class(si_cfg.adapter)
    kwargs = _resolve_secret_kwargs(si_cfg.kwargs, si_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Secret injection: %s", si_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_resource_provider(settings: Settings) -> "ResourceProvider":  # noqa: F821
    """Create the ResourceProvider adapter from dynamic config."""
    rp_cfg = settings.resource_provider
    cls = import_class(rp_cfg.adapter)
    kwargs = _resolve_secret_kwargs(rp_cfg.kwargs, rp_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Resource provider: %s", rp_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_storage_adapter(settings: Settings) -> "StoragePort":  # noqa: F821
    """Create the StoragePort adapter from dynamic config."""
    st_cfg = settings.storage
    cls = import_class(st_cfg.adapter)
    kwargs = _resolve_secret_kwargs(st_cfg.kwargs, st_cfg.secret_kwargs_env)
    instance = cls(**kwargs)
    logger.info("Storage adapter: %s", st_cfg.adapter.rsplit(".", 1)[-1])
    return instance


def _create_contributors(
    settings: Settings,
    **ports: object,
) -> list[SessionContributor]:
    """Create session contributors from dynamic config.

    Each contributor config specifies a fully-qualified class path.
    Config kwargs are merged with injected port instances so contributors
    can accept the ports they need and ignore others via **_extra.
    """
    from volundr.adapters.outbound.contributors.local_mount import LocalMountContributor

    contributors: list[SessionContributor] = []
    for cfg in settings.session_contributors:
        cls = import_class(cfg.adapter)
        resolved_kwargs = _resolve_secret_kwargs(cfg.kwargs, cfg.secret_kwargs_env)
        kwargs = {**resolved_kwargs, **ports}
        instance = cls(**kwargs)
        contributors.append(instance)
        logger.info(
            "Session contributor: %s (%s)",
            instance.name,
            cfg.adapter.rsplit(".", 1)[-1],
        )

    # Auto-wire LocalMountContributor from local_mounts config
    lm = settings.local_mounts
    local_mount_contributor = LocalMountContributor(
        enabled=lm.enabled,
        allow_root_mount=lm.allow_root_mount,
        allowed_prefixes=lm.allowed_prefixes,
    )
    contributors.append(local_mount_contributor)
    if lm.enabled:
        logger.info("Session contributor: local_mount (enabled)")

    return contributors


async def _broadcast_periodic_updates(
    broadcaster: InMemoryEventBroadcaster,
    stats_service: StatsService,
) -> None:
    """Background task to broadcast periodic stats and heartbeat updates.

    Args:
        broadcaster: The event broadcaster to publish events to.
        stats_service: The stats service to fetch current statistics.
    """
    logger.info("SSE periodic broadcast task started, interval=%ds", BROADCAST_INTERVAL)
    while True:
        try:
            await asyncio.sleep(BROADCAST_INTERVAL)

            # Only broadcast if there are subscribers
            sub_count = broadcaster.subscriber_count
            if sub_count == 0:
                logger.debug("SSE periodic: no subscribers, skipping broadcast")
                continue

            # Broadcast current stats
            logger.info("SSE periodic: broadcasting stats to %d subscriber(s)", sub_count)
            stats = await stats_service.get_stats()
            logger.info(
                "SSE periodic: stats fetched - tokens_today=%d, cloud=%d, local=%d, cost=%.4f",
                stats.tokens_today,
                stats.cloud_tokens,
                stats.local_tokens,
                float(stats.cost_today),
            )
            await broadcaster.publish_stats(stats)

            # Broadcast heartbeat
            await broadcaster.publish_heartbeat()
            logger.debug("SSE periodic: heartbeat sent")

        except asyncio.CancelledError:
            logger.info("SSE periodic broadcast task cancelled")
            break
        except Exception:
            logger.exception("SSE periodic broadcast failed")


def _create_otel_providers(otel_cfg):  # pragma: no cover
    """Build OTel TracerProvider + MeterProvider from config.

    Only called when otel is enabled and the SDK is installed.
    """
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
        OTLPMetricExporter,
    )
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": otel_cfg.service_name})

    # Traces
    span_exporter = OTLPSpanExporter(
        endpoint=otel_cfg.endpoint,
        insecure=otel_cfg.insecure,
    )
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))

    # Metrics
    metric_exporter = OTLPMetricExporter(
        endpoint=otel_cfg.endpoint,
        insecure=otel_cfg.insecure,
    )
    metric_reader = PeriodicExportingMetricReader(metric_exporter)
    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[metric_reader],
    )

    return tracer_provider, meter_provider


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application.

    Args:
        settings: Application settings. If None, uses Settings() which
                  automatically loads from YAML + env vars.
    """
    if settings is None:
        settings = Settings()

    # Configure logging from settings
    configure_logging(settings.logging)

    app = FastAPI(
        title="Volundr",
        description="Self-hosted Claude Code session manager",
        version="0.1.0",
        openapi_tags=[
            {
                "name": "Sessions",
                "description": "Session lifecycle management — create, start, stop, "
                "delete sessions and report token usage.",
            },
            {
                "name": "Chronicles",
                "description": "Session history records — snapshots of completed or "
                "in-progress sessions, reforge chains, and broker reports.",
            },
            {
                "name": "Timeline",
                "description": "Granular event timelines within a chronicle — "
                "messages, file edits, git commits, and terminal activity.",
            },
            {
                "name": "Models & Stats",
                "description": "Available LLM models and aggregate usage statistics.",
            },
            {
                "name": "Repositories",
                "description": "Git providers and repository discovery.",
            },
            {
                "name": "Profiles",
                "description": "Forge profiles — resource and workload configuration "
                "presets (read-only, config-driven).",
            },
            {
                "name": "Templates",
                "description": "Workspace templates — multi-repo workspace layouts "
                "with setup scripts (read-only, config-driven).",
            },
            {
                "name": "Git Workflow",
                "description": "Git workflow operations — create PRs from sessions, "
                "merge, check CI status, and calculate merge confidence.",
            },
            {
                "name": "MCP Servers",
                "description": "Available MCP server configurations for session setup.",
            },
            {
                "name": "Secrets",
                "description": "Kubernetes secret management — list and create "
                "mountable secrets for sessions.",
            },
            {
                "name": "Presets",
                "description": "Runtime configuration presets — portable, DB-stored "
                "bundles of model, MCP servers, resources, and environment config.",
            },
            {
                "name": "Issue Tracker",
                "description": "External issue tracker integration — search issues, "
                "update status, and manage repo-to-project mappings.",
            },
        ],
    )

    # Store settings for lifespan access
    app.state.settings = settings

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Manage application lifecycle."""
        settings = app.state.settings

        async with database_pool(settings.database) as pool:
            # Identity & authorization adapters (dynamic adapter pattern)
            tenant_repository = PostgresTenantRepository(pool)
            user_repository = PostgresUserRepository(pool)

            resource_provider = _create_resource_provider(settings)
            storage_adapter = _create_storage_adapter(settings)
            identity_adapter = _create_identity_adapter(
                settings,
                user_repository,
                storage=storage_adapter,
            )
            authorization_adapter = _create_authorization_adapter(settings)

            # Store identity/authz on app.state for auth dependencies
            app.state.identity = identity_adapter
            app.state.authorization = authorization_adapter

            # Tenant service + ensure default tenant exists
            tenant_service = TenantService(tenant_repository, user_repository)
            await tenant_service.ensure_default_tenant()

            # Create adapters
            repository = PostgresSessionRepository(pool)
            stats_repository = PostgresStatsRepository(pool)
            token_tracker = PostgresTokenTracker(pool)
            pod_manager = _create_pod_manager(settings)
            gateway_adapter = _create_gateway_adapter(settings)
            pricing_provider = HardcodedPricingProvider()
            git_registry = create_git_registry(settings.git)
            broadcaster = InMemoryEventBroadcaster()

            # Create services with broadcaster for real-time updates
            # Create profile and template adapters (config-driven)
            profile_provider = ConfigProfileProvider(settings.profiles)
            template_provider = ConfigTemplateProvider(settings.templates)

            # Create shared adapters used by both contributors and credential routes
            secret_injection = _create_secret_injection_adapter(settings)

            # Credential store (pluggable: memory, Vault, Infisical)
            from volundr.domain.services.credential import CredentialService
            from volundr.domain.services.mount_strategies import SecretMountStrategyRegistry

            credential_store = _create_credential_store(settings)

            # Inject credential store into pod manager for envSecrets resolution
            if hasattr(pod_manager, "set_credential_store"):
                pod_manager.set_credential_store(credential_store)

            # Integration registry + repository
            from volundr.domain.services.integration_registry import (
                IntegrationRegistry,
                definitions_from_config,
            )

            integration_definitions = definitions_from_config(
                [d.model_dump() for d in settings.integrations.definitions],
            )
            integration_registry = IntegrationRegistry(integration_definitions)
            integration_repo = InMemoryIntegrationRepository()

            # User integration service — ephemeral per-user provider factory.
            # Created early so session contributors can use it.
            # Issue providers are wired later when linear_adapter is available.
            from volundr.domain.services.user_integration import UserIntegrationService

            user_integration_service = UserIntegrationService(
                shared_git_providers=git_registry.providers,
                integration_repo=integration_repo,
                integration_registry=integration_registry,
                credential_store=credential_store,
            )

            # Create session contributors (dynamic adapter pattern)
            contributors = _create_contributors(
                settings,
                template_provider=template_provider,
                profile_provider=profile_provider,
                git_registry=git_registry,
                storage=storage_adapter,
                gateway=gateway_adapter,
                secret_injection=secret_injection,
                credential_store=credential_store,
                integration_repo=integration_repo,
                integration_registry=integration_registry,
                user_integration=user_integration_service,
                resource_provider=resource_provider,
            )

            session_service = SessionService(
                repository,
                pod_manager,
                git_registry=git_registry,
                validate_repos=settings.git.validate_on_create,
                broadcaster=broadcaster,
                template_provider=template_provider,
                authorization=authorization_adapter,
                contributors=contributors if contributors else None,
                provisioning_timeout=settings.provisioning.timeout_seconds,
                provisioning_initial_delay=settings.provisioning.initial_delay_seconds,
                integration_repo=integration_repo,
            )
            stats_service = StatsService(stats_repository)
            token_service = TokenService(
                token_tracker, repository, pricing_provider, broadcaster=broadcaster
            )
            repo_service = RepoService(
                git_registry,
                user_integration=user_integration_service,
            )
            chronicle_repository = PostgresChronicleRepository(pool)
            timeline_repository = PostgresTimelineRepository(pool)
            chronicle_service = ChronicleService(
                chronicle_repository,
                session_service,
                broadcaster=broadcaster,
                timeline_repository=timeline_repository,
            )

            # Create profile and template services (providers already created above)
            profile_service = ForgeProfileService(profile_provider, session_repository=repository)
            template_service = WorkspaceTemplateService(template_provider)

            # Create git workflow service (PRs sourced from GitHub/GitLab)
            git_workflow_service = GitWorkflowService(
                git_registry=git_registry,
                chronicle_repository=chronicle_repository,
                session_repository=repository,
                broadcaster=broadcaster,
                workflow_config=settings.git.workflow,
            )

            # Create and include routers
            router = create_router(
                session_service,
                stats_service,
                token_service,
                pricing_provider,
                broadcaster=broadcaster,
                repo_service=repo_service,
                chronicle_service=chronicle_service,
            )
            app.include_router(router)

            profiles_router = create_profiles_router(profile_service, template_service)
            app.include_router(profiles_router)

            # Resource discovery endpoint
            resources_router = create_resources_router(resource_provider)
            app.include_router(resources_router)
            app.state.resource_provider = resource_provider

            # MCP servers and secrets
            mcp_provider = ConfigMCPServerProvider(settings.mcp_servers)
            secret_manager = InMemorySecretManager()
            secrets_router = create_secrets_router(mcp_provider, secret_manager)
            app.include_router(secrets_router)

            # Saved prompts
            prompt_repository = PostgresPromptRepository(pool)
            prompt_service = PromptService(prompt_repository)
            prompts_router = create_prompts_router(prompt_service)
            app.include_router(prompts_router)

            # Presets (DB-stored runtime config)
            preset_repository = PostgresPresetRepository(pool)
            preset_service = PresetService(preset_repository)
            presets_router = create_presets_router(preset_service)
            app.include_router(presets_router)

            git_router = create_git_router(git_workflow_service)
            app.include_router(git_router)

            # Tenant and identity management
            tenants_router = create_tenants_router(tenant_service)
            app.include_router(tenants_router)

            # Credential management (reuses credential_store created above)
            credential_service = CredentialService(
                store=credential_store,
                strategies=SecretMountStrategyRegistry(),
            )
            credentials_router = create_credentials_router(
                credential_service,
            )
            app.include_router(credentials_router)

            # Workspace management — PVCs are the source of truth
            workspace_service = WorkspaceService(storage_adapter)
            app.state.workspace_service = workspace_service

            # Integration tracker factory (reuses integration_repo/registry created above)
            secret_repository = InMemorySecretRepository()

            from volundr.domain.services.tracker_factory import TrackerFactory

            tracker_factory = TrackerFactory(secret_repository)

            # Issue tracker integration (Linear, Jira, etc.)
            tracker_service = None
            linear_adapter = None
            if settings.linear.enabled and settings.linear.api_key:
                from volundr.adapters.outbound.linear import LinearAdapter
                from volundr.adapters.outbound.postgres_mappings import (
                    PostgresMappingRepository,
                )

                linear_adapter = LinearAdapter(api_key=settings.linear.api_key)
                mapping_repository = PostgresMappingRepository(pool)
                tracker_service = TrackerService(
                    linear_adapter,
                    mapping_repository,
                    integration_repo=integration_repo,
                    tracker_factory=tracker_factory,
                )
                tracker_router = create_tracker_router(tracker_service)
                app.include_router(tracker_router)
                logger.info("Issue tracker integration enabled (provider=linear)")

            # Integration management endpoints
            integrations_router = create_integrations_router(
                integration_repo,
                tracker_factory,
                registry=integration_registry,
            )
            app.include_router(integrations_router)

            # Wire shared issue providers now that linear_adapter is available
            if linear_adapter:
                user_integration_service.add_shared_issue_provider(linear_adapter)
            app.state.user_integration_service = user_integration_service

            # Event pipeline: sinks + ingestion service + REST endpoints
            pg_event_sink = PostgresEventSink(
                pool, buffer_size=settings.event_pipeline.postgres_buffer_size
            )
            event_sinks: list = [pg_event_sink]

            # Optional: RabbitMQ sink
            rabbitmq_sink = None
            if settings.event_pipeline.rabbitmq.enabled:
                try:
                    from volundr.adapters.outbound.rabbitmq_event_sink import (
                        RabbitMQEventSink,
                    )

                    rmq_cfg = settings.event_pipeline.rabbitmq
                    rabbitmq_sink = RabbitMQEventSink(
                        url=rmq_cfg.url,
                        exchange_name=rmq_cfg.exchange_name,
                        exchange_type=rmq_cfg.exchange_type,
                    )
                    await rabbitmq_sink.connect()
                    event_sinks.append(rabbitmq_sink)
                    logger.info("RabbitMQ event sink enabled")
                except ImportError:
                    logger.warning(
                        "RabbitMQ sink enabled but aio-pika not installed. "
                        "Install with: pip install volundr[rabbitmq]"
                    )
                except Exception:
                    logger.exception("Failed to connect RabbitMQ event sink")

            # Optional: OTel sink (GenAI semantic conventions)
            otel_sink = None
            if settings.event_pipeline.otel.enabled:
                try:
                    from volundr.adapters.outbound.otel_event_sink import (
                        OtelEventSink,
                    )

                    otel_cfg = settings.event_pipeline.otel
                    tp, mp = _create_otel_providers(otel_cfg)
                    otel_sink = OtelEventSink(
                        tracer_provider=tp,
                        meter_provider=mp,
                        service_name=otel_cfg.service_name,
                        provider_name=otel_cfg.provider_name,
                    )
                    event_sinks.append(otel_sink)
                    logger.info(
                        "OTel event sink enabled (endpoint=%s)",
                        otel_cfg.endpoint,
                    )
                except ImportError:
                    logger.warning(
                        "OTel sink enabled but opentelemetry not installed. "
                        "Install with: pip install volundr[otel]"
                    )
                except Exception:
                    logger.exception("Failed to initialize OTel event sink")

            event_ingestion = EventIngestionService(sinks=event_sinks)
            events_router = create_events_router(event_ingestion, pg_event_sink)
            app.include_router(events_router)

            # Store for access in routes if needed
            app.state.session_service = session_service
            app.state.stats_service = stats_service
            app.state.token_service = token_service
            app.state.pod_manager = pod_manager
            app.state.pricing_provider = pricing_provider
            app.state.git_registry = git_registry
            app.state.broadcaster = broadcaster
            app.state.chronicle_service = chronicle_service
            app.state.profile_service = profile_service
            app.state.template_service = template_service
            app.state.git_workflow_service = git_workflow_service
            app.state.event_ingestion = event_ingestion
            app.state.tracker_service = tracker_service
            app.state.tenant_service = tenant_service
            app.state.gateway = gateway_adapter
            app.state.user_repository = user_repository
            app.state.tenant_repository = tenant_repository
            app.state.secret_injection = secret_injection
            app.state.storage = storage_adapter

            # Start background task for periodic stats and heartbeat broadcasts
            background_task = asyncio.create_task(
                _broadcast_periodic_updates(broadcaster, stats_service)
            )

            # Reconcile sessions stuck in PROVISIONING after a restart
            await session_service.reconcile_provisioning_sessions()

            try:
                yield
            finally:
                background_task.cancel()
                try:
                    await background_task
                except asyncio.CancelledError:
                    pass
                await event_ingestion.close_all()
                if linear_adapter is not None:
                    await linear_adapter.close()
                await pod_manager.close()
                if hasattr(gateway_adapter, "close"):
                    await gateway_adapter.close()
                await git_registry.close()

    app.router.lifespan_context = lifespan

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "healthy"}

    return app


# Default app instance for uvicorn
app = create_app()


def main() -> None:
    """Run the Volundr API server."""
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    workers = int(os.environ.get("WORKERS", "4"))

    uvicorn.run(
        "volundr.main:app",
        host=host,
        port=port,
        workers=workers,
        access_log=False,
    )


if __name__ == "__main__":
    main()
