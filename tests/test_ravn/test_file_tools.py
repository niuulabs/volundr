"""Integration tests for file tools against a real tmpdir filesystem."""

from __future__ import annotations

from pathlib import Path

import pytest

from ravn.adapters.file_tools import (
    EditFileTool,
    GlobSearchTool,
    GrepSearchTool,
    ReadFileTool,
    WriteFileTool,
)

# ---------------------------------------------------------------------------
# ReadFileTool
# ---------------------------------------------------------------------------


class TestReadFileTool:
    def _tool(self, workspace: Path) -> ReadFileTool:
        return ReadFileTool(workspace=workspace)

    @pytest.mark.asyncio
    async def test_reads_file_with_line_numbers(self, tmp_path: Path):
        f = tmp_path / "hello.txt"
        f.write_text("line one\nline two\n")
        result = await self._tool(tmp_path).execute({"path": str(f)})
        assert not result.is_error
        assert "1\tline one" in result.content
        assert "2\tline two" in result.content

    @pytest.mark.asyncio
    async def test_offset_skips_leading_lines(self, tmp_path: Path):
        f = tmp_path / "multi.txt"
        f.write_text("a\nb\nc\nd\ne\n")
        result = await self._tool(tmp_path).execute({"path": str(f), "offset": 3})
        assert not result.is_error
        assert "3\tc" in result.content
        assert "a" not in result.content
        assert "b" not in result.content

    @pytest.mark.asyncio
    async def test_limit_caps_lines_returned(self, tmp_path: Path):
        f = tmp_path / "multi.txt"
        f.write_text("a\nb\nc\nd\ne\n")
        result = await self._tool(tmp_path).execute({"path": str(f), "offset": 2, "limit": 2})
        assert not result.is_error
        assert "2\tb" in result.content
        assert "3\tc" in result.content
        assert "d" not in result.content
        assert "e" not in result.content

    @pytest.mark.asyncio
    async def test_missing_file_returns_error(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute({"path": str(tmp_path / "missing.txt")})
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_directory_returns_error(self, tmp_path: Path):
        d = tmp_path / "subdir"
        d.mkdir()
        result = await self._tool(tmp_path).execute({"path": str(d)})
        assert result.is_error
        assert "not a file" in result.content.lower()

    @pytest.mark.asyncio
    async def test_size_limit_returns_error(self, tmp_path: Path):
        f = tmp_path / "big.bin"
        f.write_bytes(b"x" * (1024 * 1024 + 1))
        tool = ReadFileTool(workspace=tmp_path, max_bytes=1024 * 1024)
        result = await tool.execute({"path": str(f)})
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_path_traversal_returns_error(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute({"path": str(tmp_path / ".." / "outside.txt")})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_reads_empty_file(self, tmp_path: Path):
        f = tmp_path / "empty.txt"
        f.write_text("")
        result = await self._tool(tmp_path).execute({"path": str(f)})
        assert not result.is_error
        assert result.content == ""

    @pytest.mark.asyncio
    async def test_reads_single_line_no_newline(self, tmp_path: Path):
        f = tmp_path / "oneliner.txt"
        f.write_text("no newline")
        result = await self._tool(tmp_path).execute({"path": str(f)})
        assert not result.is_error
        assert "1\tno newline" in result.content


# ---------------------------------------------------------------------------
# WriteFileTool
# ---------------------------------------------------------------------------


class TestWriteFileTool:
    def _tool(self, workspace: Path) -> WriteFileTool:
        return WriteFileTool(workspace=workspace)

    @pytest.mark.asyncio
    async def test_creates_new_file(self, tmp_path: Path):
        path = tmp_path / "new.txt"
        result = await self._tool(tmp_path).execute({"path": str(path), "content": "hello"})
        assert not result.is_error
        assert path.read_text() == "hello"

    @pytest.mark.asyncio
    async def test_overwrites_existing_file(self, tmp_path: Path):
        f = tmp_path / "existing.txt"
        f.write_text("old content")
        result = await self._tool(tmp_path).execute({"path": str(f), "content": "new content"})
        assert not result.is_error
        assert f.read_text() == "new content"

    @pytest.mark.asyncio
    async def test_creates_parent_directories(self, tmp_path: Path):
        path = tmp_path / "a" / "b" / "c.txt"
        result = await self._tool(tmp_path).execute({"path": str(path), "content": "deep"})
        assert not result.is_error
        assert path.read_text() == "deep"

    @pytest.mark.asyncio
    async def test_path_traversal_returns_error(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute(
            {"path": str(tmp_path / ".." / "evil.txt"), "content": "bad"}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_binary_content_rejected(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute(
            {"path": str(tmp_path / "bin.txt"), "content": "hello\x00world"}
        )
        assert result.is_error
        assert "binary" in result.content.lower()

    @pytest.mark.asyncio
    async def test_size_limit_returns_error(self, tmp_path: Path):
        tool = WriteFileTool(workspace=tmp_path, max_bytes=10)
        result = await tool.execute({"path": str(tmp_path / "f.txt"), "content": "x" * 11})
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_result_mentions_written_path(self, tmp_path: Path):
        path = tmp_path / "out.txt"
        result = await self._tool(tmp_path).execute({"path": str(path), "content": "data"})
        assert not result.is_error
        assert "Written" in result.content


# ---------------------------------------------------------------------------
# EditFileTool
# ---------------------------------------------------------------------------


class TestEditFileTool:
    def _tool(self, workspace: Path) -> EditFileTool:
        return EditFileTool(workspace=workspace)

    @pytest.mark.asyncio
    async def test_replaces_unique_string(self, tmp_path: Path):
        f = tmp_path / "edit.txt"
        f.write_text("hello world")
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "world", "new_string": "earth"}
        )
        assert not result.is_error
        assert f.read_text() == "hello earth"

    @pytest.mark.asyncio
    async def test_missing_old_string_returns_error(self, tmp_path: Path):
        f = tmp_path / "edit.txt"
        f.write_text("hello")
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "xyz", "new_string": "abc"}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_duplicate_string_without_replace_all_returns_error(self, tmp_path: Path):
        f = tmp_path / "dup.txt"
        f.write_text("aa bb aa cc aa")
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "aa", "new_string": "zz"}
        )
        assert result.is_error
        assert "3" in result.content  # found 3 times

    @pytest.mark.asyncio
    async def test_replace_all_replaces_every_occurrence(self, tmp_path: Path):
        f = tmp_path / "multi.txt"
        f.write_text("aa bb aa")
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "aa", "new_string": "cc", "replace_all": True}
        )
        assert not result.is_error
        assert f.read_text() == "cc bb cc"

    @pytest.mark.asyncio
    async def test_file_not_found_returns_error(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute(
            {"path": str(tmp_path / "missing.txt"), "old_string": "x", "new_string": "y"}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_directory_returns_error(self, tmp_path: Path):
        d = tmp_path / "subdir"
        d.mkdir()
        result = await self._tool(tmp_path).execute(
            {"path": str(d), "old_string": "x", "new_string": "y"}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_path_traversal_returns_error(self, tmp_path: Path):
        result = await self._tool(tmp_path).execute(
            {
                "path": str(tmp_path / ".." / "outside.txt"),
                "old_string": "x",
                "new_string": "y",
            }
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_result_reports_replacement_count(self, tmp_path: Path):
        f = tmp_path / "rep.txt"
        f.write_text("x y x")
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "x", "new_string": "z", "replace_all": True}
        )
        assert not result.is_error
        assert "2" in result.content

    @pytest.mark.asyncio
    async def test_size_limit_after_replacement(self, tmp_path: Path):
        f = tmp_path / "expand.txt"
        f.write_text("a")
        tool = EditFileTool(workspace=tmp_path, max_bytes=5)
        result = await tool.execute({"path": str(f), "old_string": "a", "new_string": "x" * 10})
        assert result.is_error
        assert "too large" in result.content.lower()


# ---------------------------------------------------------------------------
# GlobSearchTool
# ---------------------------------------------------------------------------


class TestGlobSearchTool:
    @pytest.mark.asyncio
    async def test_matches_simple_pattern(self, tmp_path: Path):
        (tmp_path / "a.py").write_text("# a")
        (tmp_path / "b.py").write_text("# b")
        (tmp_path / "c.txt").write_text("# c")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py"})
        assert not result.is_error
        assert "a.py" in result.content
        assert "b.py" in result.content
        assert "c.txt" not in result.content

    @pytest.mark.asyncio
    async def test_recursive_pattern(self, tmp_path: Path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "x.py").write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "**/*.py"})
        assert not result.is_error
        # Path separator may vary — just check the filename is present
        assert "x.py" in result.content

    @pytest.mark.asyncio
    async def test_empty_result(self, tmp_path: Path):
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.nonexistent"})
        assert not result.is_error
        assert result.content == ""

    @pytest.mark.asyncio
    async def test_scoped_to_subdirectory(self, tmp_path: Path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "x.py").write_text("x")
        (tmp_path / "y.py").write_text("y")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py", "path": str(sub)})
        assert not result.is_error
        assert "x.py" in result.content
        # y.py is outside the sub-directory scope
        assert "y.py" not in result.content

    @pytest.mark.asyncio
    async def test_path_traversal_returns_error(self, tmp_path: Path):
        result = await GlobSearchTool(tmp_path).execute(
            {"pattern": "*", "path": str(tmp_path / ".." / "etc")}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_non_directory_path_returns_error(self, tmp_path: Path):
        f = tmp_path / "file.txt"
        f.write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*", "path": str(f)})
        assert result.is_error
        assert "not a directory" in result.content.lower()

    @pytest.mark.asyncio
    async def test_results_are_sorted(self, tmp_path: Path):
        for name in ["z.txt", "a.txt", "m.txt"]:
            (tmp_path / name).write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.txt"})
        assert not result.is_error
        lines = result.content.splitlines()
        assert lines == sorted(lines)

    @pytest.mark.asyncio
    async def test_excludes_directories_from_results(self, tmp_path: Path):
        (tmp_path / "dir").mkdir()
        (tmp_path / "file.txt").write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*"})
        assert not result.is_error
        assert "file.txt" in result.content
        assert "dir" not in result.content


# ---------------------------------------------------------------------------
# GrepSearchTool
# ---------------------------------------------------------------------------


class TestGrepSearchTool:
    @pytest.mark.asyncio
    async def test_finds_matching_lines(self, tmp_path: Path):
        (tmp_path / "a.txt").write_text("hello world\nfoo bar\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "hello", "glob": "*.txt"})
        assert not result.is_error
        assert "hello world" in result.content

    @pytest.mark.asyncio
    async def test_no_match_returns_empty(self, tmp_path: Path):
        (tmp_path / "a.txt").write_text("foo bar\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "xyz", "glob": "*.txt"})
        assert not result.is_error
        assert result.content == ""

    @pytest.mark.asyncio
    async def test_invalid_regex_returns_error(self, tmp_path: Path):
        result = await GrepSearchTool(tmp_path).execute({"pattern": "[invalid"})
        assert result.is_error
        assert "Invalid regex" in result.content

    @pytest.mark.asyncio
    async def test_grep_single_file(self, tmp_path: Path):
        f = tmp_path / "search.txt"
        f.write_text("alpha\nbeta\ngamma\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "beta", "path": str(f)})
        assert not result.is_error
        assert "beta" in result.content

    @pytest.mark.asyncio
    async def test_result_includes_line_numbers(self, tmp_path: Path):
        f = tmp_path / "nums.txt"
        f.write_text("alpha\nbeta\ngamma\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "beta", "path": str(f)})
        assert not result.is_error
        assert ":2:" in result.content

    @pytest.mark.asyncio
    async def test_result_includes_relative_path(self, tmp_path: Path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "file.txt").write_text("found here\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "found"})
        assert not result.is_error
        assert "sub" in result.content and "file.txt" in result.content

    @pytest.mark.asyncio
    async def test_path_traversal_returns_error(self, tmp_path: Path):
        result = await GrepSearchTool(tmp_path).execute(
            {"pattern": "x", "path": str(tmp_path / ".." / "evil")}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_path_not_found_returns_error(self, tmp_path: Path):
        result = await GrepSearchTool(tmp_path).execute(
            {"pattern": "x", "path": str(tmp_path / "nonexistent_dir")}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_regex_pattern_works(self, tmp_path: Path):
        f = tmp_path / "code.py"
        f.write_text("def foo():\n    pass\ndef bar():\n    pass\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": r"def \w+\(\)", "path": str(f)})
        assert not result.is_error
        assert "def foo()" in result.content
        assert "def bar()" in result.content

    @pytest.mark.asyncio
    async def test_grep_with_glob_filter(self, tmp_path: Path):
        (tmp_path / "a.py").write_text("target\n")
        (tmp_path / "b.txt").write_text("target\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "target", "glob": "*.py"})
        assert not result.is_error
        assert "a.py" in result.content
        assert "b.txt" not in result.content
