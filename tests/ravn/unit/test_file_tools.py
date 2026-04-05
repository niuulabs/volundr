"""Unit tests for file operation tools."""

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
    def test_name(self, tmp_path: Path) -> None:
        assert ReadFileTool(tmp_path).name == "read_file"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert ReadFileTool(tmp_path).description

    def test_input_schema_valid(self, tmp_path: Path) -> None:
        schema = ReadFileTool(tmp_path).input_schema
        assert schema["type"] == "object"
        assert "path" in schema["required"]

    def test_required_permission(self, tmp_path: Path) -> None:
        assert ReadFileTool(tmp_path).required_permission == "file:read"

    @pytest.mark.asyncio
    async def test_reads_file(self, tmp_path: Path) -> None:
        f = tmp_path / "hello.txt"
        f.write_text("line1\nline2\n")
        tool = ReadFileTool(tmp_path)
        result = await tool.execute({"path": str(f)})
        assert not result.is_error
        assert "line1" in result.content
        assert "line2" in result.content

    @pytest.mark.asyncio
    async def test_line_numbers_prefix(self, tmp_path: Path) -> None:
        f = tmp_path / "nums.txt"
        f.write_text("a\nb\nc\n")
        result = await ReadFileTool(tmp_path).execute({"path": str(f)})
        assert "1\ta" in result.content
        assert "2\tb" in result.content

    @pytest.mark.asyncio
    async def test_offset_and_limit(self, tmp_path: Path) -> None:
        f = tmp_path / "big.txt"
        f.write_text("\n".join(str(i) for i in range(10)))
        result = await ReadFileTool(tmp_path).execute({"path": str(f), "offset": 3, "limit": 2})
        assert not result.is_error
        lines = result.content.strip().split("\n")
        assert len(lines) == 2
        # Line 3 and 4 (1-based)
        assert "3\t2" in result.content
        assert "4\t3" in result.content

    @pytest.mark.asyncio
    async def test_file_not_found(self, tmp_path: Path) -> None:
        result = await ReadFileTool(tmp_path).execute({"path": str(tmp_path / "nope.txt")})
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_not_a_file(self, tmp_path: Path) -> None:
        subdir = tmp_path / "subdir"
        subdir.mkdir()
        result = await ReadFileTool(tmp_path).execute({"path": str(subdir)})
        assert result.is_error
        assert "not a file" in result.content.lower()

    @pytest.mark.asyncio
    async def test_file_too_large(self, tmp_path: Path) -> None:
        f = tmp_path / "big.txt"
        f.write_bytes(b"x" * 100)
        result = await ReadFileTool(tmp_path, max_bytes=10).execute({"path": str(f)})
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_path_outside_workspace(self, tmp_path: Path) -> None:
        result = await ReadFileTool(tmp_path).execute({"path": "/etc/passwd"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_absolute_path_in_workspace(self, tmp_path: Path) -> None:
        f = tmp_path / "abs.txt"
        f.write_text("content")
        result = await ReadFileTool(tmp_path).execute({"path": str(f)})
        assert not result.is_error
        assert "content" in result.content


# ---------------------------------------------------------------------------
# WriteFileTool
# ---------------------------------------------------------------------------


class TestWriteFileTool:
    def test_name(self, tmp_path: Path) -> None:
        assert WriteFileTool(tmp_path).name == "write_file"

    def test_required_permission(self, tmp_path: Path) -> None:
        assert WriteFileTool(tmp_path).required_permission == "file:write"

    def test_input_schema(self, tmp_path: Path) -> None:
        schema = WriteFileTool(tmp_path).input_schema
        assert "path" in schema["required"]
        assert "content" in schema["required"]

    @pytest.mark.asyncio
    async def test_writes_new_file(self, tmp_path: Path) -> None:
        result = await WriteFileTool(tmp_path).execute(
            {"path": str(tmp_path / "out.txt"), "content": "hello"}
        )
        assert not result.is_error
        assert (tmp_path / "out.txt").read_text() == "hello"

    @pytest.mark.asyncio
    async def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        result = await WriteFileTool(tmp_path).execute(
            {"path": str(tmp_path / "a" / "b" / "c.txt"), "content": "nested"}
        )
        assert not result.is_error
        assert (tmp_path / "a" / "b" / "c.txt").read_text() == "nested"

    @pytest.mark.asyncio
    async def test_overwrites_existing_file(self, tmp_path: Path) -> None:
        f = tmp_path / "existing.txt"
        f.write_text("old")
        await WriteFileTool(tmp_path).execute({"path": str(f), "content": "new"})
        assert f.read_text() == "new"

    @pytest.mark.asyncio
    async def test_content_too_large(self, tmp_path: Path) -> None:
        result = await WriteFileTool(tmp_path, max_bytes=5).execute(
            {"path": str(tmp_path / "big.txt"), "content": "x" * 100}
        )
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_binary_content_rejected(self, tmp_path: Path) -> None:
        binary_content = "data\x00more"
        result = await WriteFileTool(tmp_path, binary_check_bytes=100).execute(
            {"path": str(tmp_path / "bin.bin"), "content": binary_content}
        )
        assert result.is_error
        assert "binary" in result.content.lower()

    @pytest.mark.asyncio
    async def test_path_outside_workspace(self, tmp_path: Path) -> None:
        result = await WriteFileTool(tmp_path).execute({"path": "/etc/evil.txt", "content": "bad"})
        assert result.is_error


# ---------------------------------------------------------------------------
# EditFileTool
# ---------------------------------------------------------------------------


class TestEditFileTool:
    def test_name(self, tmp_path: Path) -> None:
        assert EditFileTool(tmp_path).name == "edit_file"

    def test_required_permission(self, tmp_path: Path) -> None:
        assert EditFileTool(tmp_path).required_permission == "file:write"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert EditFileTool(tmp_path).description

    def test_input_schema(self, tmp_path: Path) -> None:
        schema = EditFileTool(tmp_path).input_schema
        assert "path" in schema["required"]
        assert "old_string" in schema["required"]
        assert "new_string" in schema["required"]

    @pytest.mark.asyncio
    async def test_replaces_unique_string(self, tmp_path: Path) -> None:
        f = tmp_path / "code.py"
        f.write_text("def foo():\n    pass\n")
        result = await EditFileTool(tmp_path).execute(
            {"path": str(f), "old_string": "def foo():", "new_string": "def bar():"}
        )
        assert not result.is_error
        assert "def bar():" in f.read_text()

    @pytest.mark.asyncio
    async def test_old_string_not_found(self, tmp_path: Path) -> None:
        f = tmp_path / "code.py"
        f.write_text("hello world")
        result = await EditFileTool(tmp_path).execute(
            {"path": str(f), "old_string": "missing", "new_string": "x"}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_non_unique_raises_without_replace_all(self, tmp_path: Path) -> None:
        f = tmp_path / "dup.txt"
        f.write_text("foo foo foo")
        result = await EditFileTool(tmp_path).execute(
            {"path": str(f), "old_string": "foo", "new_string": "bar"}
        )
        assert result.is_error
        assert "3 times" in result.content

    @pytest.mark.asyncio
    async def test_replace_all_flag(self, tmp_path: Path) -> None:
        f = tmp_path / "dup.txt"
        f.write_text("foo foo foo")
        result = await EditFileTool(tmp_path).execute(
            {"path": str(f), "old_string": "foo", "new_string": "bar", "replace_all": True}
        )
        assert not result.is_error
        assert f.read_text() == "bar bar bar"

    @pytest.mark.asyncio
    async def test_file_not_found(self, tmp_path: Path) -> None:
        result = await EditFileTool(tmp_path).execute(
            {"path": str(tmp_path / "missing.txt"), "old_string": "x", "new_string": "y"}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_not_a_file(self, tmp_path: Path) -> None:
        subdir = tmp_path / "dir"
        subdir.mkdir()
        result = await EditFileTool(tmp_path).execute(
            {"path": str(subdir), "old_string": "x", "new_string": "y"}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_result_too_large(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("short")
        result = await EditFileTool(tmp_path, max_bytes=3).execute(
            {"path": str(f), "old_string": "short", "new_string": "x" * 100}
        )
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_path_outside_workspace(self, tmp_path: Path) -> None:
        result = await EditFileTool(tmp_path).execute(
            {"path": "/etc/passwd", "old_string": "root", "new_string": "bad"}
        )
        assert result.is_error

    @pytest.mark.asyncio
    async def test_replace_count_in_response(self, tmp_path: Path) -> None:
        f = tmp_path / "f.txt"
        f.write_text("aa aa")
        result = await EditFileTool(tmp_path).execute(
            {"path": str(f), "old_string": "aa", "new_string": "bb", "replace_all": True}
        )
        assert "2 occurrence" in result.content


# ---------------------------------------------------------------------------
# GlobSearchTool
# ---------------------------------------------------------------------------


class TestGlobSearchTool:
    def test_name(self, tmp_path: Path) -> None:
        assert GlobSearchTool(tmp_path).name == "glob_search"

    def test_required_permission(self, tmp_path: Path) -> None:
        assert GlobSearchTool(tmp_path).required_permission == "file:read"

    def test_input_schema(self, tmp_path: Path) -> None:
        schema = GlobSearchTool(tmp_path).input_schema
        assert "pattern" in schema["required"]

    @pytest.mark.asyncio
    async def test_finds_files_by_pattern(self, tmp_path: Path) -> None:
        (tmp_path / "a.py").write_text("a")
        (tmp_path / "b.py").write_text("b")
        (tmp_path / "c.txt").write_text("c")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py"})
        assert not result.is_error
        assert "a.py" in result.content
        assert "b.py" in result.content
        assert "c.txt" not in result.content

    @pytest.mark.asyncio
    async def test_no_matches_returns_empty(self, tmp_path: Path) -> None:
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.xyz"})
        assert not result.is_error
        assert result.content == ""

    @pytest.mark.asyncio
    async def test_recursive_glob(self, tmp_path: Path) -> None:
        subdir = tmp_path / "sub"
        subdir.mkdir()
        (subdir / "nested.py").write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "**/*.py"})
        assert "nested.py" in result.content

    @pytest.mark.asyncio
    async def test_base_path_restricts_search(self, tmp_path: Path) -> None:
        a = tmp_path / "a"
        b = tmp_path / "b"
        a.mkdir()
        b.mkdir()
        (a / "file.py").write_text("x")
        (b / "other.py").write_text("y")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py", "path": str(a)})
        assert "file.py" in result.content
        assert "other.py" not in result.content

    @pytest.mark.asyncio
    async def test_base_path_not_dir(self, tmp_path: Path) -> None:
        f = tmp_path / "notadir.txt"
        f.write_text("x")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py", "path": str(f)})
        assert result.is_error
        assert "not a directory" in result.content.lower()

    @pytest.mark.asyncio
    async def test_path_outside_workspace(self, tmp_path: Path) -> None:
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.py", "path": "/etc"})
        assert result.is_error


# ---------------------------------------------------------------------------
# GrepSearchTool
# ---------------------------------------------------------------------------


class TestGrepSearchTool:
    def test_name(self, tmp_path: Path) -> None:
        assert GrepSearchTool(tmp_path).name == "grep_search"

    def test_required_permission(self, tmp_path: Path) -> None:
        assert GrepSearchTool(tmp_path).required_permission == "file:read"

    def test_input_schema(self, tmp_path: Path) -> None:
        schema = GrepSearchTool(tmp_path).input_schema
        assert "pattern" in schema["required"]

    @pytest.mark.asyncio
    async def test_grep_finds_matches(self, tmp_path: Path) -> None:
        f = tmp_path / "code.py"
        f.write_text("def foo():\n    return 42\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "def foo"})
        assert not result.is_error
        assert "code.py" in result.content
        assert "def foo" in result.content

    @pytest.mark.asyncio
    async def test_grep_no_matches_empty(self, tmp_path: Path) -> None:
        (tmp_path / "f.txt").write_text("hello world")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "xyz123"})
        assert not result.is_error
        assert result.content == ""

    @pytest.mark.asyncio
    async def test_grep_invalid_regex(self, tmp_path: Path) -> None:
        result = await GrepSearchTool(tmp_path).execute({"pattern": "["})
        assert result.is_error
        assert "invalid regex" in result.content.lower()

    @pytest.mark.asyncio
    async def test_grep_specific_file(self, tmp_path: Path) -> None:
        f = tmp_path / "target.txt"
        f.write_text("match here\nno here\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "match", "path": str(f)})
        assert not result.is_error
        assert "match here" in result.content

    @pytest.mark.asyncio
    async def test_grep_with_glob_filter(self, tmp_path: Path) -> None:
        (tmp_path / "a.py").write_text("import os")
        (tmp_path / "b.txt").write_text("import os")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "import os", "glob": "*.py"})
        assert "a.py" in result.content
        assert "b.txt" not in result.content

    @pytest.mark.asyncio
    async def test_grep_path_not_found(self, tmp_path: Path) -> None:
        result = await GrepSearchTool(tmp_path).execute(
            {"pattern": "x", "path": str(tmp_path / "nope.txt")}
        )
        assert result.is_error
        assert "not found" in result.content.lower()

    @pytest.mark.asyncio
    async def test_grep_path_outside_workspace(self, tmp_path: Path) -> None:
        result = await GrepSearchTool(tmp_path).execute({"pattern": "root", "path": "/etc/passwd"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_grep_line_number_format(self, tmp_path: Path) -> None:
        f = tmp_path / "lines.txt"
        f.write_text("skip\nmatch\nskip\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "match", "path": str(f)})
        assert "2:match" in result.content

    @pytest.mark.asyncio
    async def test_grep_subdirectory(self, tmp_path: Path) -> None:
        subdir = tmp_path / "src"
        subdir.mkdir()
        (subdir / "main.py").write_text("hello world")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "hello", "path": str(subdir)})
        assert not result.is_error
        assert "main.py" in result.content
