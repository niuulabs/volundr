"""Tests for raid depends_on dependency support.

Covers:
- Validation accepts depends_on as an optional field
- Dispatch skips raids with unmet dependencies
- Dispatch proceeds when all dependencies are met
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.api.dispatch import _check_dependencies
from tyr.domain.models import (
    Raid,
    RaidSpec,
    RaidStatus,
    Saga,
    SagaStatus,
    TrackerIssue,
)
from tyr.domain.validation import parse_and_validate, validate_raid

NOW = datetime.now(UTC)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    *,
    name: str = "raid-1",
    tracker_id: str = "t-1",
    status: RaidStatus = RaidStatus.PENDING,
    depends_on: list[str] | None = None,
) -> Raid:
    return Raid(
        id=uuid4(),
        phase_id=UUID(int=0),
        tracker_id=tracker_id,
        name=name,
        description="",
        acceptance_criteria=[],
        declared_files=[],
        estimate_hours=None,
        status=status,
        confidence=0.0,
        session_id=None,
        branch=None,
        chronicle_summary=None,
        pr_url=None,
        pr_id=None,
        retry_count=0,
        created_at=NOW,
        updated_at=NOW,
        depends_on=depends_on or [],
    )


def _make_issue(*, issue_id: str = "i-1", title: str = "Setup CI") -> TrackerIssue:
    return TrackerIssue(
        id=issue_id,
        identifier="ALPHA-1",
        title=title,
        description="",
        status="Todo",
    )


def _make_saga(*, tracker_id: str = "proj-1") -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id=tracker_id,
        tracker_type="linear",
        slug="test",
        name="Test",
        repos=["org/repo"],
        feature_branch="feat/test",
        status=SagaStatus.ACTIVE,
        confidence=0.0,
        created_at=NOW,
    )


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


class TestValidationDependsOn:
    def test_depends_on_is_optional(self) -> None:
        """depends_on defaults to empty list when omitted."""
        spec = validate_raid(
            {
                "name": "Setup",
                "description": "Initial setup",
                "acceptance_criteria": ["Tests pass"],
            },
            "Phase 1",
            0,
        )
        assert spec.depends_on == []

    def test_depends_on_parsed(self) -> None:
        """depends_on is parsed when provided."""
        spec = validate_raid(
            {
                "name": "Add API",
                "description": "Add REST endpoints",
                "acceptance_criteria": ["Endpoints respond"],
                "depends_on": ["Setup", "Database"],
            },
            "Phase 1",
            0,
        )
        assert spec.depends_on == ["Setup", "Database"]

    def test_depends_on_filters_non_strings(self) -> None:
        """Non-string entries in depends_on are filtered out."""
        spec = validate_raid(
            {
                "name": "Add API",
                "description": "Add REST endpoints",
                "acceptance_criteria": ["Endpoints respond"],
                "depends_on": ["Setup", 42, None, "Database", ""],
            },
            "Phase 1",
            0,
        )
        assert spec.depends_on == ["Setup", "Database"]

    def test_depends_on_invalid_type_defaults_to_empty(self) -> None:
        """Non-list depends_on defaults to empty list."""
        spec = validate_raid(
            {
                "name": "Add API",
                "description": "Add REST endpoints",
                "acceptance_criteria": ["Endpoints respond"],
                "depends_on": "Setup",
            },
            "Phase 1",
            0,
        )
        assert spec.depends_on == []

    def test_parse_and_validate_with_depends_on(self) -> None:
        """Full parse_and_validate preserves depends_on through the pipeline."""
        raw = json.dumps(
            {
                "name": "My Saga",
                "phases": [
                    {
                        "name": "Phase 1",
                        "raids": [
                            {
                                "name": "Setup",
                                "description": "Initial setup",
                                "acceptance_criteria": ["Done"],
                            },
                            {
                                "name": "Build",
                                "description": "Build the thing",
                                "acceptance_criteria": ["Built"],
                                "depends_on": ["Setup"],
                            },
                        ],
                    }
                ],
            }
        )
        structure = parse_and_validate(raw)
        raids = structure.phases[0].raids
        assert raids[0].depends_on == []
        assert raids[1].depends_on == ["Setup"]


# ---------------------------------------------------------------------------
# Dispatch dependency check tests
# ---------------------------------------------------------------------------


class TestCheckDependencies:
    def test_no_dependencies_returns_empty(self) -> None:
        """Raid with no depends_on passes dependency check."""
        issue = _make_issue(issue_id="t-1", title="Setup CI")
        saga = _make_saga()
        raid = _make_raid(name="Setup CI", tracker_id="t-1")
        cache = {saga.tracker_id: [raid]}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == []

    def test_unmet_dependency_returns_names(self) -> None:
        """Raid whose dependency is not merged returns unmet names."""
        issue = _make_issue(issue_id="t-2", title="Add API")
        saga = _make_saga()
        dep_raid = _make_raid(
            name="Setup", tracker_id="t-1", status=RaidStatus.RUNNING
        )
        main_raid = _make_raid(
            name="Add API",
            tracker_id="t-2",
            depends_on=["Setup"],
        )
        cache = {saga.tracker_id: [dep_raid, main_raid]}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == ["Setup"]

    def test_met_dependency_returns_empty(self) -> None:
        """Raid whose dependency is merged passes check."""
        issue = _make_issue(issue_id="t-2", title="Add API")
        saga = _make_saga()
        dep_raid = _make_raid(
            name="Setup", tracker_id="t-1", status=RaidStatus.MERGED
        )
        main_raid = _make_raid(
            name="Add API",
            tracker_id="t-2",
            depends_on=["Setup"],
        )
        cache = {saga.tracker_id: [dep_raid, main_raid]}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == []

    def test_multiple_dependencies_partial_met(self) -> None:
        """Returns only the unmet dependencies when some are satisfied."""
        issue = _make_issue(issue_id="t-3", title="Integration")
        saga = _make_saga()
        merged_raid = _make_raid(
            name="Setup", tracker_id="t-1", status=RaidStatus.MERGED
        )
        pending_raid = _make_raid(
            name="Database", tracker_id="t-2", status=RaidStatus.PENDING
        )
        main_raid = _make_raid(
            name="Integration",
            tracker_id="t-3",
            depends_on=["Setup", "Database"],
        )
        cache = {saga.tracker_id: [merged_raid, pending_raid, main_raid]}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == ["Database"]

    def test_no_cache_entry_returns_empty(self) -> None:
        """Missing saga in cache means no dependency data — allow dispatch."""
        issue = _make_issue()
        saga = _make_saga()
        cache: dict[str, list[Raid]] = {}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == []

    def test_raid_not_found_in_cache_returns_empty(self) -> None:
        """Issue not matching any cached raid — allow dispatch."""
        issue = _make_issue(issue_id="unknown", title="Unknown")
        saga = _make_saga()
        other_raid = _make_raid(name="Other", tracker_id="t-99")
        cache = {saga.tracker_id: [other_raid]}

        unmet = _check_dependencies(issue, saga, cache)
        assert unmet == []


# ---------------------------------------------------------------------------
# RaidSpec model tests
# ---------------------------------------------------------------------------


class TestRaidSpecDependsOn:
    def test_default_empty(self) -> None:
        spec = RaidSpec(
            name="r",
            description="d",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=1.0,
            confidence=0.5,
        )
        assert spec.depends_on == []

    def test_with_depends_on(self) -> None:
        spec = RaidSpec(
            name="r",
            description="d",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=1.0,
            confidence=0.5,
            depends_on=["other-raid"],
        )
        assert spec.depends_on == ["other-raid"]
