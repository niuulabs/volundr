"""Tests for rich timeline event emission in the Skuld broker."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from volundr.skuld.broker import (
    Broker,
    SessionArtifacts,
    _extract_git_commit_info,
)
from volundr.skuld.config import SkuldSettings


class TestGitCommitExtraction:
    """Tests for git commit hash/message regex extraction."""

    def test_extract_standard_commit(self):
        output = "[main e4f7a21] fix(thermal): add derivative filter\n 2 files changed"
        result = _extract_git_commit_info(output)
        assert result is not None
        assert result[0] == "e4f7a21"
        assert result[1] == "fix(thermal): add derivative filter"

    def test_extract_long_hash(self):
        output = "[feature/xyz a1b2c3d4e5f6] feat: new feature\n"
        result = _extract_git_commit_info(output)
        assert result is not None
        assert result[0] == "a1b2c3d4e5f6"
        assert result[1] == "feat: new feature"

    def test_extract_branch_with_slashes(self):
        output = "[feat/my-branch abc1234] chore: update deps"
        result = _extract_git_commit_info(output)
        assert result is not None
        assert result[0] == "abc1234"
        assert result[1] == "chore: update deps"

    def test_no_match_returns_none(self):
        output = "nothing to commit, working tree clean"
        assert _extract_git_commit_info(output) is None

    def test_empty_output(self):
        assert _extract_git_commit_info("") is None

    def test_multiline_output_finds_commit(self):
        output = "On branch main\n[main f8c2b19] feat: windup prevention\n 1 file changed"
        result = _extract_git_commit_info(output)
        assert result is not None
        assert result[0] == "f8c2b19"
        assert result[1] == "feat: windup prevention"


class TestFileActionClassification:
    """Tests for created vs modified file classification."""

    def test_new_file_is_created(self):
        artifacts = SessionArtifacts()
        event = artifacts._classify_tool("Write", {"file_path": "src/new.py"})
        assert event is not None
        assert event["action"] == "created"
        assert "src/new.py" in artifacts._known_files

    def test_seen_file_is_modified(self):
        artifacts = SessionArtifacts()
        artifacts._known_files.add("src/existing.py")
        event = artifacts._classify_tool("Write", {"file_path": "src/existing.py"})
        assert event is not None
        assert event["action"] == "modified"

    def test_edit_always_modified(self):
        """Edit tool always modifies existing files by definition."""
        artifacts = SessionArtifacts()
        event = artifacts._classify_tool("Edit", {"file_path": "src/brand_new.py"})
        assert event is not None
        assert event["action"] == "modified"
        # Edit also tracks the file as known
        assert "src/brand_new.py" in artifacts._known_files

    def test_edit_on_known_file_is_modified(self):
        artifacts = SessionArtifacts()
        artifacts._known_files.add("src/known.py")
        event = artifacts._classify_tool("Edit", {"file_path": "src/known.py"})
        assert event is not None
        assert event["action"] == "modified"

    def test_read_tracks_file_without_event(self):
        artifacts = SessionArtifacts()
        event = artifacts._classify_tool("Read", {"file_path": "src/read_this.py"})
        assert event is None
        assert "src/read_this.py" in artifacts._known_files

    def test_read_then_write_is_modified(self):
        artifacts = SessionArtifacts()
        artifacts._classify_tool("Read", {"file_path": "src/file.py"})
        event = artifacts._classify_tool("Write", {"file_path": "src/file.py"})
        assert event is not None
        assert event["action"] == "modified"


class TestTerminalExitCodes:
    """Tests for terminal event exit code extraction."""

    def test_exit_code_from_explicit_field(self):
        result_block = {"exit_code": 0, "content": "output"}
        assert SessionArtifacts._extract_exit_code(result_block) == 0

    def test_exit_code_nonzero_from_field(self):
        result_block = {"exit_code": 127, "content": "command not found"}
        assert SessionArtifacts._extract_exit_code(result_block) == 127

    def test_exit_code_from_is_error(self):
        result_block = {"is_error": True, "content": "error output"}
        assert SessionArtifacts._extract_exit_code(result_block) == 1

    def test_exit_code_success_default(self):
        result_block = {"content": "all good"}
        assert SessionArtifacts._extract_exit_code(result_block) == 0

    def test_enrich_terminal_with_exit_code(self):
        artifacts = SessionArtifacts()
        tool_events = [
            {"type": "terminal", "label": "ls -la", "_tool_use_id": "tu_1"},
        ]
        data = {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": "file1.txt\nfile2.txt",
                    "is_error": False,
                },
            ],
        }
        artifacts.enrich_from_tool_result(data, tool_events)
        assert tool_events[0]["exit"] == 0

    def test_enrich_terminal_error_exit(self):
        artifacts = SessionArtifacts()
        tool_events = [
            {"type": "terminal", "label": "bad-cmd", "_tool_use_id": "tu_2"},
        ]
        data = {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_2",
                    "content": "command not found",
                    "is_error": True,
                },
            ],
        }
        artifacts.enrich_from_tool_result(data, tool_events)
        assert tool_events[0]["exit"] == 1


class TestGitEventEnrichment:
    """Tests for git event enrichment from tool_result."""

    def test_enrich_git_with_commit_info(self):
        artifacts = SessionArtifacts()
        tool_events = [
            {
                "type": "git",
                "label": "git commit -m 'fix: stuff'",
                "_pending_git": True,
                "_tool_use_id": "tu_git",
            },
        ]
        data = {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_git",
                    "content": "[main a1b2c3d] fix: stuff\n 1 file changed",
                },
            ],
        }
        artifacts.enrich_from_tool_result(data, tool_events)
        assert tool_events[0]["hash"] == "a1b2c3d"
        assert tool_events[0]["label"] == "fix: stuff"

    def test_git_without_matching_result_keeps_label(self):
        artifacts = SessionArtifacts()
        tool_events = [
            {
                "type": "git",
                "label": "git commit -m 'fix: stuff'",
                "_pending_git": True,
                "_tool_use_id": "tu_git_nomatch",
            },
        ]
        data = {"content": []}
        artifacts.enrich_from_tool_result(data, tool_events)
        assert tool_events[0]["label"] == "git commit -m 'fix: stuff'"
        assert "hash" not in tool_events[0]


class TestSessionLifecycleEvents:
    """Tests for session start timeline event."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="subprocess",
        )
        b = Broker(settings=settings)
        b.volundr_api_url = "http://volundr:80"
        return b

    @pytest.mark.asyncio
    async def test_session_start_event_emitted_once(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            await test_broker._report_session_start()
            await test_broker._report_session_start()  # second call should be no-op

            # Should only be called once with session event
            timeline_calls = [
                c for c in mock_report.call_args_list if c[0][0].get("type") == "session"
            ]
            assert len(timeline_calls) == 1
            event = timeline_calls[0][0][0]
            assert event["t"] == 0
            assert event["type"] == "session"
            assert event["label"] == "Session started"


class TestMessageTimelineEvents:
    """Tests for message timeline events with rich labels."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="subprocess",
        )
        b = Broker(settings=settings)
        b.volundr_api_url = "http://volundr:80"
        return b

    @pytest.mark.asyncio
    async def test_message_event_uses_first_line(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_report_usage", new_callable=AsyncMock),
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            data = {
                "type": "result",
                "result": "I'll review the thermal calibration code.\n\nLet me start by...",
                "modelUsage": {
                    "claude-opus-4-20250514": {
                        "inputTokens": 1000,
                        "outputTokens": 200,
                        "cacheReadInputTokens": 0,
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            await test_broker._handle_cli_event(data)
            await asyncio.sleep(0.05)

            message_calls = [
                c for c in mock_report.call_args_list if c[0][0].get("type") == "message"
            ]
            assert len(message_calls) == 1
            event = message_calls[0][0][0]
            assert event["label"] == "I'll review the thermal calibration code."
            assert event["tokens"] == 1200

    @pytest.mark.asyncio
    async def test_message_event_falls_back_to_turn_number(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_report_usage", new_callable=AsyncMock),
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            data = {
                "type": "result",
                "result": "",
                "modelUsage": {
                    "claude-opus-4-20250514": {
                        "inputTokens": 500,
                        "outputTokens": 100,
                        "cacheReadInputTokens": 0,
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            await test_broker._handle_cli_event(data)
            await asyncio.sleep(0.05)

            message_calls = [
                c for c in mock_report.call_args_list if c[0][0].get("type") == "message"
            ]
            assert len(message_calls) == 1
            event = message_calls[0][0][0]
            assert event["label"] == "Turn 1"

    @pytest.mark.asyncio
    async def test_message_event_extracts_from_content_blocks(self, test_broker):
        with (
            patch.object(
                test_broker, "_report_timeline_event", new_callable=AsyncMock
            ) as mock_report,
            patch.object(test_broker, "_report_usage", new_callable=AsyncMock),
            patch.object(test_broker, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            data = {
                "type": "result",
                "content": [
                    {"type": "text", "text": "Add derivative filtering to PID controller"},
                ],
                "modelUsage": {
                    "claude-opus-4-20250514": {
                        "inputTokens": 2000,
                        "outputTokens": 500,
                        "cacheReadInputTokens": 0,
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            await test_broker._handle_cli_event(data)
            await asyncio.sleep(0.05)

            message_calls = [
                c for c in mock_report.call_args_list if c[0][0].get("type") == "message"
            ]
            assert len(message_calls) == 1
            event = message_calls[0][0][0]
            assert event["label"] == "Add derivative filtering to PID controller"


class TestErrorTimelineEvents:
    """Tests for error timeline event capture."""

    @pytest.fixture
    def test_broker(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="subprocess",
        )
        b = Broker(settings=settings)
        b.volundr_api_url = "http://volundr:80"
        return b

    @pytest.mark.asyncio
    async def test_error_event_with_content(self, test_broker):
        with patch.object(
            test_broker, "_report_timeline_event", new_callable=AsyncMock
        ) as mock_report:
            data = {
                "type": "error",
                "content": "TypeError: NoneType in temperature callback",
            }
            await test_broker._handle_cli_event(data)
            await asyncio.sleep(0.05)

            error_calls = [c for c in mock_report.call_args_list if c[0][0].get("type") == "error"]
            assert len(error_calls) == 1
            event = error_calls[0][0][0]
            assert event["type"] == "error"
            assert event["label"] == "TypeError: NoneType in temperature callback"

    @pytest.mark.asyncio
    async def test_error_event_with_error_dict(self, test_broker):
        with patch.object(
            test_broker, "_report_timeline_event", new_callable=AsyncMock
        ) as mock_report:
            data = {
                "type": "error",
                "error": {"message": "Connection refused", "code": 500},
            }
            await test_broker._handle_cli_event(data)
            await asyncio.sleep(0.05)

            error_calls = [c for c in mock_report.call_args_list if c[0][0].get("type") == "error"]
            assert len(error_calls) == 1
            event = error_calls[0][0][0]
            assert event["label"] == "Connection refused"


class TestElapsedTimeCalculation:
    """Tests for correct elapsed time in timeline events."""

    def test_duration_seconds_from_monotonic(self):
        artifacts = SessionArtifacts()
        # started_at is set on creation, duration should be ~0
        assert artifacts.duration_seconds >= 0

    @pytest.mark.asyncio
    async def test_timeline_event_t_uses_duration(self, tmp_path):
        settings = SkuldSettings(
            session={"id": "test-session", "workspace_dir": str(tmp_path)},
            transport="subprocess",
        )
        b = Broker(settings=settings)
        b.volundr_api_url = "http://volundr:80"

        with (
            patch.object(b, "_report_timeline_event", new_callable=AsyncMock) as mock_report,
            patch.object(b, "_report_usage", new_callable=AsyncMock),
            patch.object(b, "_emit_pipeline_event", new_callable=AsyncMock),
        ):
            data = {
                "type": "result",
                "result": "Some response text here",
                "modelUsage": {
                    "model": {
                        "inputTokens": 100,
                        "outputTokens": 50,
                        "cacheReadInputTokens": 0,
                        "cacheCreationInputTokens": 0,
                    }
                },
            }
            await b._handle_cli_event(data)
            await asyncio.sleep(0.05)

            message_calls = [
                c for c in mock_report.call_args_list if c[0][0].get("type") == "message"
            ]
            assert len(message_calls) == 1
            event = message_calls[0][0][0]
            # t should be an integer >= 0
            assert isinstance(event["t"], int)
            assert event["t"] >= 0
