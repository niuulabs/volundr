"""Port for contract negotiation persistence."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from uuid import UUID

from tyr.domain.models import ContractNegotiation, ContractStatus


class ContractRepository(ABC):
    """Repository port for ContractNegotiation persistence.

    ``get_by_planner_session`` is critical — ActivitySubscriber uses it
    to route idle events from the planner session to ContractEngine,
    exactly as ReviewEngine.get_reviewer_raid() does for reviewer sessions.
    """

    @abstractmethod
    async def create(self, contract: ContractNegotiation) -> None:
        """Persist a new contract negotiation."""

    @abstractmethod
    async def get(self, contract_id: UUID) -> ContractNegotiation:
        """Retrieve a contract negotiation by ID.

        Raises:
            KeyError: If the contract is not found.
        """

    @abstractmethod
    async def update_status(
        self,
        contract_id: UUID,
        status: ContractStatus,
        acceptance_criteria: list[str] | None = None,
        declared_files: list[str] | None = None,
        rounds: int | None = None,
        agreed_at: datetime | None = None,
    ) -> ContractNegotiation:
        """Update a contract negotiation's status and optional fields.

        Raises:
            KeyError: If the contract is not found.
        """

    @abstractmethod
    async def get_for_raid(self, raid_id: UUID) -> ContractNegotiation | None:
        """Retrieve the contract negotiation for a raid, if any."""

    @abstractmethod
    async def get_by_planner_session(self, session_id: str) -> ContractNegotiation | None:
        """Retrieve the contract negotiation for a planner session, if any."""
