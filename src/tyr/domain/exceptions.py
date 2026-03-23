"""Domain exceptions for the Tyr saga coordinator."""


class InvalidStateTransitionError(Exception):
    """Raised when an invalid state transition is attempted on a Raid."""

    def __init__(self, current: str, target: str) -> None:
        self.current = current
        self.target = target
        super().__init__(f"Invalid state transition: {current} -> {target}")
