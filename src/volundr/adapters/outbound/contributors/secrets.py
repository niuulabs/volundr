"""Secret injection contributors — wraps SecretInjectionPort and SecretRepository."""

import logging
from typing import Any

from volundr.domain.models import MountType, Session
from volundr.domain.ports import (
    CredentialStorePort,
    SecretInjectionPort,
    SecretRepository,
    SessionContext,
    SessionContribution,
    SessionContributor,
)

logger = logging.getLogger(__name__)


class SecretInjectionContributor(SessionContributor):
    """Returns PodSpecAdditions for CSI-based secret injection and user-selected credentials."""

    def __init__(
        self,
        *,
        secret_injection: SecretInjectionPort | None = None,
        credential_store: CredentialStorePort | None = None,
        **_extra: object,
    ):
        self._secret_injection = secret_injection
        self._credential_store = credential_store
        from volundr.domain.services.mount_strategies import SecretMountStrategyRegistry

        self._strategies = SecretMountStrategyRegistry()

    @property
    def name(self) -> str:
        return "secret_injection"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        pod_spec = None
        values: dict[str, Any] = {}

        # CSI-based injection (existing behavior)
        if self._secret_injection and session.owner_id:
            pod_spec = await self._secret_injection.pod_spec_additions(
                session.owner_id,
                str(session.id),
            )

        # User-selected credentials → env vars
        if context.credential_names and self._credential_store and context.principal:
            env_secrets = await self._resolve_credential_env_secrets(context)
            if env_secrets:
                values["envSecrets"] = env_secrets

        return SessionContribution(values=values, pod_spec=pod_spec)

    async def _resolve_credential_env_secrets(
        self,
        context: SessionContext,
    ) -> list[dict[str, str]]:
        """Resolve user-selected credential names into envSecrets entries."""
        if not self._credential_store or not context.principal:
            return []

        env_secrets: list[dict[str, str]] = []
        for cred_name in context.credential_names:
            cred = await self._credential_store.get(
                "user",
                context.principal.user_id,
                cred_name,
            )
            if not cred:
                logger.warning(
                    "Credential %r not found for user %s",
                    cred_name,
                    context.principal.user_id,
                )
                continue

            strategy = self._strategies.get(cred.secret_type)
            mount_spec = strategy.default_mount_spec(cred_name, {})
            if mount_spec.mount_type != MountType.ENV_FILE:
                continue

            for key in cred.keys:
                env_secrets.append(
                    {
                        "envVar": key.upper(),
                        "secretName": cred_name,
                        "secretKey": key,
                    }
                )

        return env_secrets


class SecretsContributor(SessionContributor):
    """Creates ephemeral session secrets via SecretRepository."""

    def __init__(
        self,
        *,
        secret_repo: SecretRepository | None = None,
        **_extra: object,
    ):
        self._secret_repo = secret_repo

    @property
    def name(self) -> str:
        return "secrets"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        # Session secret creation is done during contribute if needed
        # For now, this is a placeholder that will be wired up in NIU-124
        return SessionContribution()

    async def cleanup(
        self,
        session: Session,
        context: SessionContext,
    ) -> None:
        if self._secret_repo is None:
            return
        await self._secret_repo.delete_session_secrets(str(session.id))
