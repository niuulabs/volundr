"""Tests for the ContractRepository port using an in-memory implementation."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from tyr.domain.models import ContractNegotiation, ContractStatus
from tyr.ports.contract_repository import ContractRepository


class InMemoryContractRepository(ContractRepository):
    """In-memory implementation of ContractRepository for testing."""

    def __init__(self) -> None:
        self._store: dict[str, ContractNegotiation] = {}

    async def create(self, contract: ContractNegotiation) -> None:
        self._store[str(contract.id)] = contract

    async def get(self, contract_id) -> ContractNegotiation:
        key = str(contract_id)
        if key not in self._store:
            raise KeyError(f"Contract {contract_id} not found")
        return self._store[key]

    async def update_status(
        self,
        contract_id,
        status,
        acceptance_criteria=None,
        declared_files=None,
        rounds=None,
        agreed_at=None,
    ) -> ContractNegotiation:
        existing = await self.get(contract_id)
        updates: dict = {"status": status}
        if acceptance_criteria is not None:
            updates["acceptance_criteria"] = acceptance_criteria
        if declared_files is not None:
            updates["declared_files"] = declared_files
        if rounds is not None:
            updates["rounds"] = rounds
        if agreed_at is not None:
            updates["agreed_at"] = agreed_at
        updated = replace(existing, **updates)
        self._store[str(contract_id)] = updated
        return updated

    async def get_for_raid(self, raid_id) -> ContractNegotiation | None:
        for contract in self._store.values():
            if contract.raid_id == raid_id:
                return contract
        return None

    async def get_by_planner_session(self, session_id) -> ContractNegotiation | None:
        for contract in self._store.values():
            if contract.planner_session_id == session_id:
                return contract
        return None


@pytest.fixture()
def repo() -> InMemoryContractRepository:
    return InMemoryContractRepository()


def _make_contract(**overrides) -> ContractNegotiation:
    defaults = {
        "id": uuid4(),
        "raid_id": uuid4(),
        "planner_session_id": "planner-1",
        "working_session_id": "worker-1",
        "status": ContractStatus.PENDING,
        "acceptance_criteria": [],
        "declared_files": [],
        "rounds": 0,
        "created_at": datetime.now(UTC),
        "agreed_at": None,
    }
    defaults.update(overrides)
    return ContractNegotiation(**defaults)


class TestContractRepositoryCreate:
    async def test_create_and_get(self, repo: InMemoryContractRepository):
        contract = _make_contract()
        await repo.create(contract)
        result = await repo.get(contract.id)
        assert result == contract

    async def test_get_missing_raises(self, repo: InMemoryContractRepository):
        with pytest.raises(KeyError):
            await repo.get(uuid4())


class TestContractRepositoryUpdateStatus:
    async def test_update_status_only(self, repo: InMemoryContractRepository):
        contract = _make_contract()
        await repo.create(contract)
        updated = await repo.update_status(contract.id, ContractStatus.AGREED)
        assert updated.status == ContractStatus.AGREED
        assert updated.acceptance_criteria == contract.acceptance_criteria

    async def test_update_with_all_fields(self, repo: InMemoryContractRepository):
        contract = _make_contract()
        await repo.create(contract)
        now = datetime.now(UTC)
        updated = await repo.update_status(
            contract.id,
            ContractStatus.AGREED,
            acceptance_criteria=["tests pass"],
            declared_files=["src/a.py"],
            rounds=3,
            agreed_at=now,
        )
        assert updated.status == ContractStatus.AGREED
        assert updated.acceptance_criteria == ["tests pass"]
        assert updated.declared_files == ["src/a.py"]
        assert updated.rounds == 3
        assert updated.agreed_at == now

    async def test_update_missing_raises(self, repo: InMemoryContractRepository):
        with pytest.raises(KeyError):
            await repo.update_status(uuid4(), ContractStatus.FAILED)


class TestContractRepositoryQueries:
    async def test_get_for_raid(self, repo: InMemoryContractRepository):
        raid_id = uuid4()
        contract = _make_contract(raid_id=raid_id)
        await repo.create(contract)
        result = await repo.get_for_raid(raid_id)
        assert result == contract

    async def test_get_for_raid_missing(self, repo: InMemoryContractRepository):
        result = await repo.get_for_raid(uuid4())
        assert result is None

    async def test_get_by_planner_session(self, repo: InMemoryContractRepository):
        contract = _make_contract(planner_session_id="session-abc")
        await repo.create(contract)
        result = await repo.get_by_planner_session("session-abc")
        assert result == contract

    async def test_get_by_planner_session_missing(self, repo: InMemoryContractRepository):
        result = await repo.get_by_planner_session("nonexistent")
        assert result is None
