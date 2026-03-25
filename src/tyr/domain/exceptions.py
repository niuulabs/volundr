"""Domain exceptions for the Tyr saga coordinator."""

from __future__ import annotations

from uuid import UUID


class InvalidStateTransitionError(Exception):
    """Raised when an invalid state transition is attempted on a Raid."""

    def __init__(self, current: str, target: str) -> None:
        self.current = current
        self.target = target
        super().__init__(f"Invalid state transition: {current} -> {target}")


class RaidNotFoundError(Exception):
    """Raised when a raid cannot be found by ID."""

    def __init__(self, raid_id: UUID | str) -> None:
        self.raid_id = raid_id
        super().__init__(f"Raid not found: {raid_id}")
