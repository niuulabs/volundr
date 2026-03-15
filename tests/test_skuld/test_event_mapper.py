"""Tests for the JSONL → chronicle timeline event mapper."""

from volundr.skuld.event_mapper import EventMapper, _extract_git_commit_info, _is_git_commit


class TestGitHelpers:
    def test_is_git_commit_plain(self):
        assert _is_git_commit("git commit -m 'fix'")

    def test_is_git_commit_chained(self):
        assert _is_git_commit("git add . && git commit -m 'fix'")

    def test_is_git_commit_with_config(self):
        assert _is_git_commit("git -c user.name=x commit -m 'fix'")

    def test_not_git_commit(self):
        assert not _is_git_commit("git status")
        assert not _is_git_commit("echo hello")

    def test_extract_commit_info(self):
        output = "[main e4f7a21] fix: something\n 2 files changed"
        result = _extract_git_commit_info(output)
        assert result == ("e4f7a21", "fix: something")

    def test_extract_commit_info_no_match(self):
        assert _extract_git_commit_info("nothing here") is None


class TestClassifyTool:
    def setup_method(self):
        self.mapper = EventMapper()

    def test_write_new_file(self):
        line = _assistant_with_tool("Write", {"file_path": "/tmp/new.py"})
        events = self.mapper.map_event(line)
        assert len(events) >= 1
        file_ev = [e for e in events if e["type"] == "file"]
        assert len(file_ev) == 1
        assert file_ev[0]["action"] == "created"
        assert file_ev[0]["label"] == "/tmp/new.py"

    def test_write_known_file_is_modified(self):
        self.mapper._known_files.add("/tmp/existing.py")
        line = _assistant_with_tool("Write", {"file_path": "/tmp/existing.py"})
        events = self.mapper.map_event(line)
        file_ev = [e for e in events if e["type"] == "file"]
        assert file_ev[0]["action"] == "modified"

    def test_edit_always_modified(self):
        line = _assistant_with_tool("Edit", {"file_path": "/tmp/foo.py"})
        events = self.mapper.map_event(line)
        file_ev = [e for e in events if e["type"] == "file"]
        assert file_ev[0]["action"] == "modified"

    def test_read_tracks_file_no_event(self):
        line = _assistant_with_tool("Read", {"file_path": "/tmp/bar.py"})
        events = self.mapper.map_event(line)
        # Read doesn't produce a timeline event
        file_ev = [e for e in events if e["type"] == "file"]
        assert len(file_ev) == 0
        # But the file is now known
        assert "/tmp/bar.py" in self.mapper._known_files

    def test_bash_terminal_event(self):
        line = _assistant_with_tool("Bash", {"command": "npm install"})
        events = self.mapper.map_event(line)
        term_ev = [e for e in events if e["type"] == "terminal"]
        assert len(term_ev) == 1
        assert term_ev[0]["label"] == "npm install"

    def test_bash_git_commit_buffered(self):
        line = _assistant_with_tool(
            "Bash",
            {"command": "git commit -m 'fix: bug'"},
            tool_use_id="tool-123",
        )
        events = self.mapper.map_event(line)
        # Git events are buffered for enrichment — no events emitted yet
        assert len(events) == 0
        assert "tool-123" in self.mapper._pending

    def test_unknown_tool_ignored(self):
        line = _assistant_with_tool("Agent", {"prompt": "do something"})
        events = self.mapper.map_event(line)
        file_ev = [e for e in events if e["type"] in ("file", "terminal", "git")]
        assert len(file_ev) == 0


class TestToolResultEnrichment:
    def setup_method(self):
        self.mapper = EventMapper()

    def test_git_commit_enriched(self):
        # First: tool_use for git commit (gets buffered)
        tool_line = _assistant_with_tool(
            "Bash",
            {"command": "git commit -m 'fix: thing'"},
            tool_use_id="tool-git",
        )
        self.mapper.map_event(tool_line)
        assert "tool-git" in self.mapper._pending

        # Then: tool_result with commit output
        result_line = _user_with_result(
            "tool-git",
            "[main abc1234] fix: thing\n 1 file changed",
        )
        events = self.mapper.map_event(result_line)
        assert len(events) == 1
        assert events[0]["type"] == "git"
        assert events[0]["hash"] == "abc1234"
        assert events[0]["label"] == "fix: thing"

    def test_terminal_enriched_with_exit_code(self):
        tool_line = _assistant_with_tool(
            "Bash",
            {"command": "ls /tmp"},
            tool_use_id="tool-ls",
        )
        self.mapper.map_event(tool_line)

        result_line = _user_with_result("tool-ls", "file1\nfile2", is_error=False)
        events = self.mapper.map_event(result_line)
        assert len(events) == 1
        assert events[0]["type"] == "terminal"
        assert events[0]["exit"] == 0

    def test_terminal_error_exit_code(self):
        tool_line = _assistant_with_tool(
            "Bash",
            {"command": "cat /nonexistent"},
            tool_use_id="tool-err",
        )
        self.mapper.map_event(tool_line)

        result_line = _user_with_result("tool-err", "No such file", is_error=True)
        events = self.mapper.map_event(result_line)
        assert events[0]["exit"] == 1


class TestTokenExtraction:
    def setup_method(self):
        self.mapper = EventMapper()

    def test_message_event_on_stop(self):
        line = {
            "type": "assistant",
            "timestamp": "2026-03-15T02:42:36.450Z",
            "message": {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Here is the result."}],
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_input_tokens": 200,
                    "cache_creation_input_tokens": 30,
                },
            },
        }
        events = self.mapper.map_event(line)
        msg_ev = [e for e in events if e["type"] == "message"]
        assert len(msg_ev) == 1
        assert msg_ev[0]["tokens"] == 380  # 100 + 50 + 200 + 30
        assert msg_ev[0]["label"] == "Here is the result."

    def test_no_message_without_stop_reason(self):
        line = {
            "type": "assistant",
            "timestamp": "2026-03-15T02:42:36.450Z",
            "message": {
                "stop_reason": None,
                "content": [{"type": "text", "text": "Partial..."}],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        }
        events = self.mapper.map_event(line)
        msg_ev = [e for e in events if e["type"] == "message"]
        assert len(msg_ev) == 0

    def test_label_truncated(self):
        long_text = "A" * 200
        line = {
            "type": "assistant",
            "timestamp": "2026-03-15T02:42:36.450Z",
            "message": {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": long_text}],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        }
        events = self.mapper.map_event(line)
        msg_ev = [e for e in events if e["type"] == "message"]
        assert len(msg_ev[0]["label"]) <= 80


class TestElapsedTime:
    def test_first_event_is_zero(self):
        mapper = EventMapper()
        line = _assistant_with_tool(
            "Bash",
            {"command": "echo hi"},
            timestamp="2026-03-15T02:42:00.000Z",
        )
        events = mapper.map_event(line)
        assert all(e["t"] == 0 for e in events)

    def test_subsequent_events_have_offset(self):
        mapper = EventMapper()
        line1 = _assistant_with_tool(
            "Bash",
            {"command": "echo 1"},
            timestamp="2026-03-15T02:42:00.000Z",
        )
        mapper.map_event(line1)

        line2 = _assistant_with_tool(
            "Bash",
            {"command": "echo 2"},
            timestamp="2026-03-15T02:42:30.000Z",
        )
        events = mapper.map_event(line2)
        assert events[0]["t"] == 30


class TestSkippedEvents:
    def setup_method(self):
        self.mapper = EventMapper()

    def test_user_event_skipped(self):
        events = self.mapper.map_event({"type": "user", "message": {"content": "hi"}})
        assert events == []

    def test_progress_event_skipped(self):
        events = self.mapper.map_event({"type": "progress", "data": {"type": "agent_progress"}})
        assert events == []

    def test_system_event_skipped(self):
        events = self.mapper.map_event({"type": "system", "subtype": "stop_hook_summary"})
        assert events == []


class TestFileHistorySnapshot:
    def test_snapshot_updates_known_files(self):
        mapper = EventMapper()
        mapper.map_event(
            {
                "type": "file-history-snapshot",
                "snapshot": {
                    "trackedFileBackups": {
                        "/tmp/known.py": {"some": "data"},
                        "/tmp/also_known.py": {},
                    },
                },
            }
        )
        assert "/tmp/known.py" in mapper._known_files
        assert "/tmp/also_known.py" in mapper._known_files

        # Now a Write to known file should be "modified"
        line = _assistant_with_tool("Write", {"file_path": "/tmp/known.py"})
        events = mapper.map_event(line)
        file_ev = [e for e in events if e["type"] == "file"]
        assert file_ev[0]["action"] == "modified"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assistant_with_tool(
    tool_name: str,
    tool_input: dict,
    *,
    tool_use_id: str = "",
    timestamp: str = "2026-03-15T02:42:36.450Z",
) -> dict:
    block: dict = {
        "type": "tool_use",
        "name": tool_name,
        "input": tool_input,
    }
    if tool_use_id:
        block["id"] = tool_use_id
    return {
        "type": "assistant",
        "timestamp": timestamp,
        "message": {
            "stop_reason": None,
            "content": [block],
            "usage": {},
        },
    }


def _user_with_result(
    tool_use_id: str,
    content: str,
    *,
    is_error: bool = False,
) -> dict:
    return {
        "type": "assistant",
        "timestamp": "2026-03-15T02:42:40.000Z",
        "message": {
            "stop_reason": None,
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content,
                    "is_error": is_error,
                },
            ],
            "usage": {},
        },
    }
