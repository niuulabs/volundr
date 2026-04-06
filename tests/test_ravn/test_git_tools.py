"""Tests for git operation tools."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from ravn.adapters.tools.git import (
    GitAddTool,
    GitCheckoutTool,
    GitCommitTool,
    GitDiffTool,
    GitLogTool,
    GitPrTool,
    GitStatusTool,
    _parse_status_output,
)

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
    )


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Minimal git repository with one initial commit."""
    _git(tmp_path, "init", "-b", "main")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test User")
    _git(tmp_path, "config", "commit.gpgsign", "false")
    (tmp_path / "README.md").write_text("# Test\n")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "initial commit")
    return tmp_path


# ---------------------------------------------------------------------------
# _parse_status_output
# ---------------------------------------------------------------------------


class TestParseStatusOutput:
    def test_clean_repo(self):
        output = "# branch.oid abc123\n# branch.head main\n"
        result = _parse_status_output(output)
        assert result["branch"] == "main"
        assert result["clean"] is True
        assert result["staged"] == []
        assert result["unstaged"] == []
        assert result["untracked"] == []

    def test_upstream_and_ab(self):
        output = (
            "# branch.oid abc\n"
            "# branch.head main\n"
            "# branch.upstream origin/main\n"
            "# branch.ab +3 -1\n"
        )
        result = _parse_status_output(output)
        assert result["upstream"] == "origin/main"
        assert result["ahead"] == 3
        assert result["behind"] == 1

    def test_staged_modified(self):
        output = "# branch.head main\n1 M. N... 100644 100644 100644 a b file.py\n"
        result = _parse_status_output(output)
        assert "file.py" in result["staged"]
        assert result["unstaged"] == []

    def test_unstaged_modified(self):
        output = "# branch.head main\n1 .M N... 100644 100644 100644 a b file.py\n"
        result = _parse_status_output(output)
        assert result["staged"] == []
        assert "file.py" in result["unstaged"]
        assert result["clean"] is False

    def test_both_staged_and_unstaged(self):
        output = "# branch.head main\n1 MM N... 100644 100644 100644 a b file.py\n"
        result = _parse_status_output(output)
        assert "file.py" in result["staged"]
        assert "file.py" in result["unstaged"]

    def test_untracked_file(self):
        output = "# branch.head main\n? newfile.txt\n"
        result = _parse_status_output(output)
        assert "newfile.txt" in result["untracked"]
        assert result["clean"] is False

    def test_renamed_entry(self):
        output = "# branch.head main\n2 R. N... 100644 100644 100644 a b R100 new.py\told.py\n"
        result = _parse_status_output(output)
        assert "new.py" in result["staged"]

    def test_no_upstream(self):
        output = "# branch.head feature\n"
        result = _parse_status_output(output)
        assert result["upstream"] is None
        assert result["ahead"] == 0
        assert result["behind"] == 0


# ---------------------------------------------------------------------------
# GitStatusTool
# ---------------------------------------------------------------------------


class TestGitStatusTool:
    def _tool(self, repo: Path) -> GitStatusTool:
        return GitStatusTool(workspace=repo)

    async def test_clean_repo_is_clean(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["clean"] is True
        assert data["branch"] == "main"

    async def test_untracked_file_appears(self, git_repo: Path):
        (git_repo / "new.txt").write_text("hello")
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        data = json.loads(result.content)
        assert "new.txt" in data["untracked"]
        assert data["clean"] is False

    async def test_staged_file_appears(self, git_repo: Path):
        f = git_repo / "staged.py"
        f.write_text("x = 1\n")
        _git(git_repo, "add", "staged.py")
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        data = json.loads(result.content)
        assert "staged.py" in data["staged"]

    async def test_unstaged_modified_file(self, git_repo: Path):
        (git_repo / "README.md").write_text("# Modified\n")
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        data = json.loads(result.content)
        assert "README.md" in data["unstaged"]

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:read"

    async def test_not_a_git_repo_returns_error(self, tmp_path: Path):
        result = await GitStatusTool(workspace=tmp_path).execute({})
        assert result.is_error


# ---------------------------------------------------------------------------
# GitDiffTool
# ---------------------------------------------------------------------------


class TestGitDiffTool:
    def _tool(self, repo: Path) -> GitDiffTool:
        return GitDiffTool(workspace=repo)

    async def test_no_changes_empty_diff(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        assert result.content == ""

    async def test_unstaged_change_shows_diff(self, git_repo: Path):
        (git_repo / "README.md").write_text("# Changed\n")
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        assert "README.md" in result.content
        assert "Changed" in result.content

    async def test_staged_flag_shows_index_diff(self, git_repo: Path):
        f = git_repo / "new.py"
        f.write_text("print('hi')\n")
        _git(git_repo, "add", "new.py")
        result = await self._tool(git_repo).execute({"staged": True})
        assert not result.is_error
        assert "new.py" in result.content

    async def test_paths_filter(self, git_repo: Path):
        (git_repo / "README.md").write_text("# Changed\n")
        other = git_repo / "other.txt"
        other.write_text("other\n")
        # Only diff README
        result = await self._tool(git_repo).execute({"paths": ["README.md"]})
        assert not result.is_error
        assert "README.md" in result.content
        assert "other.txt" not in result.content

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:read"


# ---------------------------------------------------------------------------
# GitAddTool
# ---------------------------------------------------------------------------


class TestGitAddTool:
    def _tool(self, repo: Path) -> GitAddTool:
        return GitAddTool(workspace=repo)

    async def test_stage_single_file(self, git_repo: Path):
        f = git_repo / "new.py"
        f.write_text("x = 1\n")
        result = await self._tool(git_repo).execute({"paths": ["new.py"]})
        assert not result.is_error
        data = json.loads(result.content)
        assert "new.py" in data["staged"]

    async def test_stage_multiple_files(self, git_repo: Path):
        (git_repo / "a.py").write_text("a\n")
        (git_repo / "b.py").write_text("b\n")
        result = await self._tool(git_repo).execute({"paths": ["a.py", "b.py"]})
        assert not result.is_error
        data = json.loads(result.content)
        assert len(data["staged"]) == 2

    async def test_empty_paths_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"paths": []})
        assert result.is_error
        assert "must not be empty" in result.content

    async def test_missing_paths_key_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert result.is_error

    async def test_nonexistent_path_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"paths": ["does_not_exist.py"]})
        assert result.is_error

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:write"


# ---------------------------------------------------------------------------
# GitCommitTool
# ---------------------------------------------------------------------------


class TestGitCommitTool:
    def _tool(self, repo: Path) -> GitCommitTool:
        return GitCommitTool(workspace=repo)

    async def test_no_staged_changes_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"message": "wip"})
        assert result.is_error
        assert "no staged changes" in result.content

    async def test_empty_message_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"message": ""})
        assert result.is_error
        assert "must not be empty" in result.content

    async def test_missing_message_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert result.is_error

    async def test_creates_commit_with_staged_changes(self, git_repo: Path):
        f = git_repo / "feat.py"
        f.write_text("x = 42\n")
        _git(git_repo, "add", "feat.py")
        result = await self._tool(git_repo).execute({"message": "feat: add feat.py"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["sha"]
        assert data["message"] == "feat: add feat.py"

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:write"


# ---------------------------------------------------------------------------
# GitCheckoutTool
# ---------------------------------------------------------------------------


class TestGitCheckoutTool:
    def _tool(self, repo: Path) -> GitCheckoutTool:
        return GitCheckoutTool(workspace=repo)

    async def test_create_new_branch(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": "feature/x", "create": True})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["branch"] == "feature/x"
        assert data["created"] is True

    async def test_switch_to_existing_branch(self, git_repo: Path):
        _git(git_repo, "branch", "other")
        result = await self._tool(git_repo).execute({"branch": "other"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["branch"] == "other"
        assert data["created"] is False

    async def test_empty_branch_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": ""})
        assert result.is_error
        assert "must not be empty" in result.content

    async def test_nonexistent_branch_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": "no-such-branch"})
        assert result.is_error

    async def test_dirty_working_tree_includes_warning(self, git_repo: Path):
        _git(git_repo, "branch", "clean-branch")
        # Make tree dirty
        (git_repo / "README.md").write_text("dirty\n")
        result = await self._tool(git_repo).execute({"branch": "clean-branch"})
        assert not result.is_error
        data = json.loads(result.content)
        assert "warning" in data
        assert "uncommitted" in data["warning"]

    async def test_branch_starting_with_dash_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": "--all"})
        assert result.is_error
        assert "must not start with '-'" in result.content

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:write"


# ---------------------------------------------------------------------------
# GitLogTool
# ---------------------------------------------------------------------------


class TestGitLogTool:
    def _tool(self, repo: Path) -> GitLogTool:
        return GitLogTool(workspace=repo)

    async def test_returns_initial_commit(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["count"] >= 1
        commit = data["commits"][0]
        assert commit["sha"]
        assert commit["short_sha"]
        assert commit["author"] == "Test User"
        assert commit["email"] == "test@example.com"
        assert "initial commit" in commit["message"]

    async def test_depth_limits_count(self, git_repo: Path):
        # Add a second commit
        (git_repo / "extra.py").write_text("x\n")
        _git(git_repo, "add", "extra.py")
        _git(git_repo, "commit", "-m", "second commit")
        result = await self._tool(git_repo).execute({"depth": 1})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["count"] == 1

    async def test_branch_filter(self, git_repo: Path):
        # Create a branch and add a commit on it
        _git(git_repo, "checkout", "-b", "alt")
        (git_repo / "alt.py").write_text("alt\n")
        _git(git_repo, "add", "alt.py")
        _git(git_repo, "commit", "-m", "alt commit")
        result = await self._tool(git_repo).execute({"branch": "main"})
        assert not result.is_error
        data = json.loads(result.content)
        messages = [c["message"] for c in data["commits"]]
        assert "alt commit" not in messages

    async def test_invalid_branch_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": "no-such-branch"})
        assert result.is_error

    async def test_flag_injection_branch_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"branch": "--all"})
        assert result.is_error
        assert "must not start with '-'" in result.content

    async def test_message_with_null_byte_sep_parsed_correctly(self, git_repo: Path):
        """Commit messages containing the old '||SEP||' string are handled correctly."""
        (git_repo / "sep.py").write_text("x\n")
        _git(git_repo, "add", "sep.py")
        _git(git_repo, "commit", "-m", "fix: message with ||SEP|| inside")
        result = await self._tool(git_repo).execute({"depth": 1})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["count"] == 1
        assert "||SEP||" in data["commits"][0]["message"]

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:read"


# ---------------------------------------------------------------------------
# Timeout behaviour
# ---------------------------------------------------------------------------


class TestTimeouts:
    async def test_run_git_timeout_returns_error(self, git_repo: Path):
        """A stuck git process should return a timeout error, not hang forever."""
        with patch(
            "ravn.adapters.tools.git.asyncio.wait_for",
            side_effect=asyncio.TimeoutError,
        ):
            result = await GitStatusTool(workspace=git_repo).execute({})
        assert result.is_error
        assert "timed out" in result.content

    async def test_run_gh_timeout_returns_error(self, git_repo: Path):
        """A stuck gh process should return a timeout error, not hang forever."""
        from unittest.mock import MagicMock

        # communicate() is passed to the mocked wait_for (which never calls it),
        # so it must NOT be a coroutine to avoid "never awaited" warnings.
        mock_proc = MagicMock()
        mock_proc.communicate = MagicMock()
        mock_proc.kill = MagicMock()  # proc.kill() is a sync call
        mock_proc.wait = AsyncMock()  # await proc.wait() is async
        with (
            patch("ravn.adapters.tools.git._gh_available", AsyncMock(return_value=True)),
            patch(
                "ravn.adapters.tools.git.asyncio.create_subprocess_exec",
                AsyncMock(return_value=mock_proc),
            ),
            patch(
                "ravn.adapters.tools.git.asyncio.wait_for",
                side_effect=asyncio.TimeoutError,
            ),
        ):
            result = await GitPrTool(workspace=git_repo).execute({"title": "My PR"})
        assert result.is_error
        assert "timed out" in result.content


# ---------------------------------------------------------------------------
# GitPrTool
# ---------------------------------------------------------------------------


class TestGitPrTool:
    def _tool(self, repo: Path) -> GitPrTool:
        return GitPrTool(workspace=repo)

    async def test_empty_title_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({"title": ""})
        assert result.is_error
        assert "must not be empty" in result.content

    async def test_missing_title_returns_error(self, git_repo: Path):
        result = await self._tool(git_repo).execute({})
        assert result.is_error

    async def test_gh_unavailable_fallback(self, git_repo: Path):
        _git(git_repo, "remote", "add", "origin", "https://github.com/test/repo.git")
        with patch("ravn.adapters.tools.git._gh_available", AsyncMock(return_value=False)):
            result = await self._tool(git_repo).execute({"title": "My PR"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["fallback"] is True
        assert data["url"] is None
        assert "github.com" in data["remote"]

    async def test_gh_available_creates_pr(self, git_repo: Path):
        pr_url = "https://github.com/test/repo/pull/42"
        with (
            patch("ravn.adapters.tools.git._gh_available", AsyncMock(return_value=True)),
            patch(
                "ravn.adapters.tools.git._run_gh",
                AsyncMock(return_value=(0, pr_url + "\n", "")),
            ),
        ):
            result = await self._tool(git_repo).execute(
                {"title": "feat: my PR", "body": "description", "base": "main"}
            )
        assert not result.is_error
        data = json.loads(result.content)
        assert data["url"] == pr_url

    async def test_gh_available_failure_returns_error(self, git_repo: Path):
        with (
            patch("ravn.adapters.tools.git._gh_available", AsyncMock(return_value=True)),
            patch(
                "ravn.adapters.tools.git._run_gh",
                AsyncMock(return_value=(1, "", "authentication required")),
            ),
        ):
            result = await self._tool(git_repo).execute({"title": "My PR"})
        assert result.is_error
        assert "authentication required" in result.content

    async def test_gh_available_draft_pr(self, git_repo: Path):
        pr_url = "https://github.com/test/repo/pull/99"
        captured: list[tuple] = []

        async def fake_run_gh(*args: str, cwd: Path) -> tuple[int, str, str]:
            captured.append(args)
            return 0, pr_url + "\n", ""

        with (
            patch("ravn.adapters.tools.git._gh_available", AsyncMock(return_value=True)),
            patch("ravn.adapters.tools.git._run_gh", fake_run_gh),
        ):
            result = await self._tool(git_repo).execute({"title": "Draft PR", "draft": True})
        assert not result.is_error
        assert "--draft" in captured[0]

    async def test_required_permission(self, git_repo: Path):
        assert self._tool(git_repo).required_permission == "git:write"


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------


class TestToolMetadata:
    """Verify name, description, and input_schema are populated correctly."""

    @pytest.mark.parametrize(
        "tool_cls,expected_name",
        [
            (GitStatusTool, "git_status"),
            (GitDiffTool, "git_diff"),
            (GitAddTool, "git_add"),
            (GitCommitTool, "git_commit"),
            (GitCheckoutTool, "git_checkout"),
            (GitLogTool, "git_log"),
            (GitPrTool, "git_pr"),
        ],
    )
    def test_tool_name(self, tool_cls, expected_name, tmp_path: Path):
        tool = tool_cls(workspace=tmp_path)
        assert tool.name == expected_name

    @pytest.mark.parametrize(
        "tool_cls",
        [
            GitStatusTool,
            GitDiffTool,
            GitAddTool,
            GitCommitTool,
            GitCheckoutTool,
            GitLogTool,
            GitPrTool,
        ],
    )
    def test_tool_description_non_empty(self, tool_cls, tmp_path: Path):
        tool = tool_cls(workspace=tmp_path)
        assert tool.description

    @pytest.mark.parametrize(
        "tool_cls",
        [
            GitStatusTool,
            GitDiffTool,
            GitAddTool,
            GitCommitTool,
            GitCheckoutTool,
            GitLogTool,
            GitPrTool,
        ],
    )
    def test_input_schema_has_type(self, tool_cls, tmp_path: Path):
        tool = tool_cls(workspace=tmp_path)
        assert tool.input_schema["type"] == "object"

    @pytest.mark.parametrize(
        "tool_cls",
        [
            GitStatusTool,
            GitDiffTool,
            GitAddTool,
            GitCommitTool,
            GitCheckoutTool,
            GitLogTool,
            GitPrTool,
        ],
    )
    def test_to_api_dict(self, tool_cls, tmp_path: Path):
        tool = tool_cls(workspace=tmp_path)
        api = tool.to_api_dict()
        assert api["name"] == tool.name
        assert api["description"] == tool.description
        assert api["input_schema"] == tool.input_schema
