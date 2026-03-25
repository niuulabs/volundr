"""Tests for Tyr port interfaces."""

import inspect

import pytest

from tyr.ports.confidence import ConfidencePort
from tyr.ports.git import GitPort
from tyr.ports.llm import LLMPort
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import VolundrPort


class TestTrackerPort:
    def test_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            TrackerPort()  # type: ignore[abstract]

    def test_methods_exist(self) -> None:
        methods = {
            "create_saga",
            "create_phase",
            "create_raid",
            "update_raid_state",
            "close_raid",
            "get_saga",
            "get_phase",
            "get_raid",
            "list_pending_raids",
            "list_projects",
            "get_project",
            "list_milestones",
            "list_issues",
        }
        abstract_methods = {
            name
            for name, _ in inspect.getmembers(TrackerPort, predicate=inspect.isfunction)
            if not name.startswith("_")
        }
        assert methods == abstract_methods


class TestVolundrPort:
    def test_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            VolundrPort()  # type: ignore[abstract]

    def test_methods_exist(self) -> None:
        methods = {
            "spawn_session",
            "get_session",
            "list_sessions",
            "get_pr_status",
            "get_chronicle_summary",
            "send_message",
            "subscribe_activity",
        }
        abstract_methods = {
            name
            for name, _ in inspect.getmembers(VolundrPort, predicate=inspect.isfunction)
            if not name.startswith("_")
        }
        assert methods == abstract_methods


class TestLLMPort:
    def test_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            LLMPort()  # type: ignore[abstract]

    def test_methods_exist(self) -> None:
        methods = {"decompose_spec"}
        abstract_methods = {
            name
            for name, _ in inspect.getmembers(LLMPort, predicate=inspect.isfunction)
            if not name.startswith("_")
        }
        assert methods == abstract_methods


class TestGitPort:
    def test_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            GitPort()  # type: ignore[abstract]

    def test_methods_exist(self) -> None:
        methods = {"create_branch", "merge_branch", "delete_branch", "create_pr", "get_pr_status"}
        abstract_methods = {
            name
            for name, _ in inspect.getmembers(GitPort, predicate=inspect.isfunction)
            if not name.startswith("_")
        }
        assert methods == abstract_methods


class TestConfidencePort:
    def test_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            ConfidencePort()  # type: ignore[abstract]

    def test_methods_exist(self) -> None:
        methods = {"score_initial", "update_score", "get_score"}
        abstract_methods = {
            name
            for name, _ in inspect.getmembers(ConfidencePort, predicate=inspect.isfunction)
            if not name.startswith("_")
        }
        assert methods == abstract_methods
