"""Shared Forge application service for route orchestration."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID

    from volundr.adapters.inbound.rest import SessionCreate
    from volundr.domain.models import ModelProvider, Principal, Session, SessionActivityState
    from volundr.domain.ports import PricingProvider
    from volundr.domain.services.stats import StatsService
    from volundr.domain.services.token import TokenService

    from .session import SessionService


class ForgeService:
    """Compose the session, stats, pricing, and token services behind Forge routes."""

    def __init__(
        self,
        session_service: SessionService,
        *,
        stats_service: StatsService | None = None,
        token_service: TokenService | None = None,
        pricing_provider: PricingProvider | None = None,
    ) -> None:
        self._session_service = session_service
        self._stats_service = stats_service
        self._token_service = token_service
        self._pricing_provider = pricing_provider

    @property
    def has_broadcaster(self) -> bool:
        return self._session_service._broadcaster is not None

    async def list_sessions(
        self,
        *,
        status=None,
        include_archived: bool = False,
        principal: Principal | None = None,
    ) -> list[Session]:
        return await self._session_service.list_sessions(
            status=status,
            include_archived=include_archived,
            principal=principal,
        )

    async def archive_stopped_sessions(self) -> list[UUID]:
        return await self._session_service.archive_stopped_sessions()

    async def create_and_start_session(
        self,
        data: SessionCreate,
        *,
        principal: Principal | None = None,
    ) -> Session:
        session = await self._session_service.create_session(
            name=data.name,
            model=data.model,
            source=data.source,
            template_name=data.template_name,
            preset_id=data.preset_id,
            principal=principal,
            workspace_id=data.workspace_id,
            tracker_issue_id=data.issue_id,
            issue_tracker_url=data.issue_url,
        )
        return await self._session_service.start_session(
            session.id,
            profile_name=data.profile_name,
            template_name=data.template_name,
            principal=principal,
            terminal_restricted=data.terminal_restricted,
            credential_names=data.credential_names,
            integration_ids=data.integration_ids,
            resource_config=data.resource_config or None,
            system_prompt=data.system_prompt,
            initial_prompt=data.initial_prompt,
            workload_type=data.workload_type,
            workload_config=data.workload_config or None,
        )

    async def get_session(self, session_id: UUID) -> Session | None:
        return await self._session_service.get_session(session_id)

    async def ensure_access(
        self,
        session: Session,
        principal: Principal | None,
        action: str = "view",
    ) -> None:
        await self._session_service._check_access(session, principal, action)

    async def update_session(
        self,
        *,
        session_id: UUID,
        name: str | None = None,
        model: str | None = None,
        branch: str | None = None,
        tracker_issue_id: str | None = None,
        principal: Principal | None = None,
    ) -> Session:
        return await self._session_service.update_session(
            session_id=session_id,
            name=name,
            model=model,
            branch=branch,
            tracker_issue_id=tracker_issue_id,
            principal=principal,
        )

    async def delete_session(
        self,
        session_id: UUID,
        *,
        principal: Principal | None = None,
        cleanup_targets=None,
    ) -> bool:
        return await self._session_service.delete_session(
            session_id,
            principal=principal,
            cleanup_targets=cleanup_targets,
        )

    async def start_session(
        self,
        session_id: UUID,
        *,
        profile_name: str | None = None,
        principal: Principal | None = None,
    ) -> Session:
        return await self._session_service.start_session(
            session_id,
            profile_name=profile_name,
            principal=principal,
        )

    async def stop_session(
        self,
        session_id: UUID,
        *,
        principal: Principal | None = None,
    ) -> Session:
        return await self._session_service.stop_session(session_id, principal=principal)

    async def update_activity(
        self,
        session_id: UUID,
        activity_state: SessionActivityState,
        metadata: dict | None,
    ) -> Session:
        return await self._session_service.update_activity(session_id, activity_state, metadata)

    async def archive_session(
        self,
        session_id: UUID,
        *,
        principal: Principal | None = None,
    ) -> Session:
        return await self._session_service.archive_session(session_id, principal=principal)

    async def restore_session(
        self,
        session_id: UUID,
        *,
        principal: Principal | None = None,
    ) -> Session:
        return await self._session_service.restore_session(session_id, principal=principal)

    def list_models(self):
        if self._pricing_provider is None:
            raise RuntimeError("Pricing provider not available")
        return self._pricing_provider.list_models()

    async def get_stats(self):
        if self._stats_service is None:
            raise RuntimeError("Stats service not available")
        return await self._stats_service.get_stats()

    async def record_usage(
        self,
        *,
        session_id: UUID,
        tokens: int,
        provider: ModelProvider,
        model: str,
        message_count: int = 0,
        cost: float | None = None,
    ):
        if self._token_service is None:
            raise RuntimeError("Token service not available")
        return await self._token_service.record_usage(
            session_id=session_id,
            tokens=tokens,
            provider=provider,
            model=model,
            message_count=message_count,
            cost=cost,
        )
