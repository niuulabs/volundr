"""Tests for Tyr domain models and state machine transitions."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from tyr.domain.models import (
    RAID_TRANSITIONS,
    ConfidenceEventType,
    ContractNegotiation,
    ContractStatus,
    RaidStatus,
    is_valid_transition,
)


class TestRaidStatus:
    """RaidStatus enum contains all expected members."""

    def test_queued_exists(self):
        assert RaidStatus.QUEUED == "QUEUED"

    def test_contracting_exists(self):
        assert RaidStatus.CONTRACTING == "CONTRACTING"

    def test_running_exists(self):
        assert RaidStatus.RUNNING == "RUNNING"

    def test_escalated_exists(self):
        assert RaidStatus.ESCALATED == "ESCALATED"

    def test_failed_exists(self):
        assert RaidStatus.FAILED == "FAILED"

    def test_completed_exists(self):
        assert RaidStatus.COMPLETED == "COMPLETED"


class TestRaidTransitions:
    """RAID_TRANSITIONS allows the specified state machine paths."""

    def test_queued_to_contracting(self):
        assert is_valid_transition(RaidStatus.QUEUED, RaidStatus.CONTRACTING)

    def test_queued_to_running(self):
        assert is_valid_transition(RaidStatus.QUEUED, RaidStatus.RUNNING)

    def test_queued_to_failed(self):
        assert is_valid_transition(RaidStatus.QUEUED, RaidStatus.FAILED)

    def test_contracting_to_running(self):
        assert is_valid_transition(RaidStatus.CONTRACTING, RaidStatus.RUNNING)

    def test_contracting_to_escalated(self):
        assert is_valid_transition(RaidStatus.CONTRACTING, RaidStatus.ESCALATED)

    def test_contracting_to_failed(self):
        assert is_valid_transition(RaidStatus.CONTRACTING, RaidStatus.FAILED)

    def test_running_to_completed(self):
        assert is_valid_transition(RaidStatus.RUNNING, RaidStatus.COMPLETED)

    def test_running_to_escalated(self):
        assert is_valid_transition(RaidStatus.RUNNING, RaidStatus.ESCALATED)

    def test_running_to_failed(self):
        assert is_valid_transition(RaidStatus.RUNNING, RaidStatus.FAILED)

    def test_escalated_to_failed(self):
        assert is_valid_transition(RaidStatus.ESCALATED, RaidStatus.FAILED)

    def test_failed_is_terminal(self):
        assert RAID_TRANSITIONS[RaidStatus.FAILED] == frozenset()

    def test_completed_is_terminal(self):
        assert RAID_TRANSITIONS[RaidStatus.COMPLETED] == frozenset()

    def test_invalid_queued_to_completed(self):
        assert not is_valid_transition(RaidStatus.QUEUED, RaidStatus.COMPLETED)

    def test_invalid_contracting_to_completed(self):
        assert not is_valid_transition(RaidStatus.CONTRACTING, RaidStatus.COMPLETED)

    def test_invalid_completed_to_running(self):
        assert not is_valid_transition(RaidStatus.COMPLETED, RaidStatus.RUNNING)

    def test_invalid_failed_to_running(self):
        assert not is_valid_transition(RaidStatus.FAILED, RaidStatus.RUNNING)

    def test_all_statuses_have_transition_entry(self):
        for status in RaidStatus:
            assert status in RAID_TRANSITIONS


class TestContractStatus:
    """ContractStatus enum contains all expected members."""

    def test_pending(self):
        assert ContractStatus.PENDING == "PENDING"

    def test_agreed(self):
        assert ContractStatus.AGREED == "AGREED"

    def test_failed(self):
        assert ContractStatus.FAILED == "FAILED"


class TestConfidenceEventType:
    """ConfidenceEventType includes contract events."""

    def test_contract_agreed(self):
        assert ConfidenceEventType.CONTRACT_AGREED == "contract_agreed"

    def test_contract_failed(self):
        assert ConfidenceEventType.CONTRACT_FAILED == "contract_failed"


class TestContractNegotiation:
    """ContractNegotiation dataclass construction and immutability."""

    @pytest.fixture()
    def contract(self) -> ContractNegotiation:
        return ContractNegotiation(
            id=uuid4(),
            raid_id=uuid4(),
            planner_session_id="planner-abc",
            working_session_id="worker-xyz",
            status=ContractStatus.PENDING,
            acceptance_criteria=["all tests pass", "coverage > 85%"],
            declared_files=["src/main.py", "tests/test_main.py"],
            rounds=0,
            created_at=datetime.now(UTC),
            agreed_at=None,
        )

    def test_fields_accessible(self, contract: ContractNegotiation):
        assert contract.planner_session_id == "planner-abc"
        assert contract.working_session_id == "worker-xyz"
        assert contract.status == ContractStatus.PENDING
        assert len(contract.acceptance_criteria) == 2
        assert len(contract.declared_files) == 2
        assert contract.rounds == 0
        assert contract.agreed_at is None

    def test_frozen(self, contract: ContractNegotiation):
        with pytest.raises(AttributeError):
            contract.status = ContractStatus.AGREED  # type: ignore[misc]

    def test_agreed_contract(self):
        now = datetime.now(UTC)
        contract = ContractNegotiation(
            id=uuid4(),
            raid_id=uuid4(),
            planner_session_id="planner-1",
            working_session_id="worker-1",
            status=ContractStatus.AGREED,
            acceptance_criteria=["lint clean"],
            declared_files=["src/app.py"],
            rounds=2,
            created_at=now,
            agreed_at=now,
        )
        assert contract.status == ContractStatus.AGREED
        assert contract.agreed_at == now
        assert contract.rounds == 2
