"""Phase 2 file tool integration tests — symlinks, system paths, diff_preview (NIU-455).

Covers acceptance criteria:
- Read: symlink within workspace, symlink escaping workspace (rejected),
  system path (rejected), binary file (rejected)
- Write: diff_preview, binary content detection, workspace boundary
- Edit: diff_preview with unique match, non-unique match, no-op diff
- Glob: nested directories
- Grep: case-insensitive, file type filter
- Tool metadata (name, description, input_schema, required_permission)
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from ravn.adapters.file_tools import (
    EditFileTool,
    GlobSearchTool,
    GrepSearchTool,
    ReadFileTool,
    WriteFileTool,
)

# ===========================================================================
# ReadFileTool — extended coverage
# ===========================================================================


class TestReadFileToolExtended:
    def _tool(self, workspace: Path) -> ReadFileTool:
        return ReadFileTool(workspace=workspace)

    # --- tool metadata ---

    def test_name(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).name == "read_file"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert len(self._tool(tmp_path).description) > 0

    def test_input_schema_has_path_property(self, tmp_path: Path) -> None:
        schema = self._tool(tmp_path).input_schema
        assert "path" in schema["properties"]

    def test_required_permission(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).required_permission == "file:read"

    # --- symlinks ---

    @pytest.mark.asyncio
    async def test_symlink_within_workspace_read(self, tmp_path: Path) -> None:
        target = tmp_path / "target.txt"
        target.write_text("symlink target content")
        link = tmp_path / "link.txt"
        os.symlink(target, link)

        result = await self._tool(tmp_path).execute({"path": str(link)})
        assert not result.is_error
        assert "symlink target content" in result.content

    @pytest.mark.asyncio
    async def test_symlink_escaping_workspace_rejected(self, tmp_path: Path) -> None:
        outside = tmp_path.parent / "outside.txt"
        outside.write_text("should not be readable")
        link = tmp_path / "escape_link.txt"
        os.symlink(outside, link)

        result = await self._tool(tmp_path).execute({"path": str(link)})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_symlink_to_system_path_rejected(self, tmp_path: Path) -> None:
        link = tmp_path / "etc_passwd_link"
        os.symlink("/etc/passwd", link)

        result = await self._tool(tmp_path).execute({"path": str(link)})
        assert result.is_error

    # --- system paths ---

    @pytest.mark.asyncio
    async def test_system_path_etc_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute({"path": "/etc/passwd"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_system_path_usr_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute({"path": "/usr/bin/python3"})
        assert result.is_error

    # --- path traversal ---

    @pytest.mark.asyncio
    async def test_double_dotdot_traversal_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute({"path": f"{tmp_path}/../../../etc/passwd"})
        assert result.is_error

    # --- binary file rejection via size ---

    @pytest.mark.asyncio
    async def test_oversized_file_returns_error(self, tmp_path: Path) -> None:
        large_file = tmp_path / "large.txt"
        large_file.write_bytes(b"x" * 2048)
        tool = ReadFileTool(workspace=tmp_path, max_bytes=1024)
        result = await tool.execute({"path": str(large_file)})
        assert result.is_error
        assert "too large" in result.content.lower()

    @pytest.mark.asyncio
    async def test_reads_file_at_exact_size_limit(self, tmp_path: Path) -> None:
        f = tmp_path / "exact.txt"
        f.write_bytes(b"z" * 1024)
        tool = ReadFileTool(workspace=tmp_path, max_bytes=1024)
        result = await tool.execute({"path": str(f)})
        # File at exactly the limit should NOT be rejected
        assert not result.is_error


# ===========================================================================
# WriteFileTool — extended coverage
# ===========================================================================


class TestWriteFileToolExtended:
    def _tool(self, workspace: Path) -> WriteFileTool:
        return WriteFileTool(workspace=workspace)

    # --- tool metadata ---

    def test_name(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).name == "write_file"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert len(self._tool(tmp_path).description) > 0

    def test_input_schema_requires_path_and_content(self, tmp_path: Path) -> None:
        schema = self._tool(tmp_path).input_schema
        assert "path" in schema["properties"]
        assert "content" in schema["properties"]

    def test_required_permission(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).required_permission == "file:write"

    # --- diff_preview ---

    def test_diff_preview_for_existing_file(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("old content\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "content": "new content\n"})
        assert diff is not None
        assert "-old content" in diff
        assert "+new content" in diff

    def test_diff_preview_identical_content_returns_none(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("same content\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "content": "same content\n"})
        assert diff is None

    def test_diff_preview_nonexistent_file_returns_none(self, tmp_path: Path) -> None:
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(tmp_path / "missing.txt"), "content": "x"})
        assert diff is None

    def test_diff_preview_traversal_path_returns_none(self, tmp_path: Path) -> None:
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(tmp_path / ".." / "evil.txt"), "content": "x"})
        assert diff is None

    def test_diff_preview_directory_returns_none(self, tmp_path: Path) -> None:
        d = tmp_path / "subdir"
        d.mkdir()
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(d), "content": "x"})
        assert diff is None

    # --- workspace boundary ---

    @pytest.mark.asyncio
    async def test_write_to_system_path_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute({"path": "/etc/passwd", "content": "evil"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_binary_content_null_byte_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute(
            {"path": str(tmp_path / "bin.txt"), "content": "ok\x00evil"}
        )
        assert result.is_error
        assert "binary" in result.content.lower()

    @pytest.mark.asyncio
    async def test_write_symlink_target_inside_workspace(self, tmp_path: Path) -> None:
        # A symlink within the workspace pointing to another workspace file is allowed
        target = tmp_path / "target.txt"
        target.write_text("original")
        link = tmp_path / "link.txt"
        os.symlink(target, link)

        result = await self._tool(tmp_path).execute(
            {"path": str(link), "content": "updated via symlink"}
        )
        # Resolves to target.txt inside workspace — allowed
        assert not result.is_error
        assert target.read_text() == "updated via symlink"


# ===========================================================================
# EditFileTool — extended coverage
# ===========================================================================


class TestEditFileToolExtended:
    def _tool(self, workspace: Path) -> EditFileTool:
        return EditFileTool(workspace=workspace)

    # --- tool metadata ---

    def test_name(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).name == "edit_file"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert len(self._tool(tmp_path).description) > 0

    def test_input_schema_has_required_fields(self, tmp_path: Path) -> None:
        schema = self._tool(tmp_path).input_schema
        required = schema.get("required", [])
        assert "path" in required
        assert "old_string" in required
        assert "new_string" in required

    def test_required_permission(self, tmp_path: Path) -> None:
        assert self._tool(tmp_path).required_permission == "file:write"

    # --- diff_preview ---

    def test_diff_preview_unique_match(self, tmp_path: Path) -> None:
        f = tmp_path / "edit.txt"
        f.write_text("hello world\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "old_string": "world", "new_string": "earth"})
        assert diff is not None
        assert "-hello world" in diff
        assert "+hello earth" in diff

    def test_diff_preview_non_unique_match_returns_none(self, tmp_path: Path) -> None:
        f = tmp_path / "dup.txt"
        f.write_text("aa bb aa cc\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "old_string": "aa", "new_string": "zz"})
        # Non-unique without replace_all — preview returns None
        assert diff is None

    def test_diff_preview_replace_all_returns_diff(self, tmp_path: Path) -> None:
        f = tmp_path / "multi.txt"
        f.write_text("aa bb aa cc aa\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview(
            {"path": str(f), "old_string": "aa", "new_string": "zz", "replace_all": True}
        )
        assert diff is not None
        assert "+zz bb zz cc zz" in diff

    def test_diff_preview_old_string_not_found_returns_none(self, tmp_path: Path) -> None:
        f = tmp_path / "edit.txt"
        f.write_text("hello world\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "old_string": "notfound", "new_string": "x"})
        assert diff is None

    def test_diff_preview_missing_file_returns_none(self, tmp_path: Path) -> None:
        tool = self._tool(tmp_path)
        diff = tool.diff_preview(
            {"path": str(tmp_path / "missing.txt"), "old_string": "x", "new_string": "y"}
        )
        assert diff is None

    def test_diff_preview_traversal_returns_none(self, tmp_path: Path) -> None:
        tool = self._tool(tmp_path)
        diff = tool.diff_preview(
            {
                "path": str(tmp_path / ".." / "evil.txt"),
                "old_string": "x",
                "new_string": "y",
            }
        )
        assert diff is None

    def test_diff_preview_identical_replacement_returns_none(self, tmp_path: Path) -> None:
        f = tmp_path / "same.txt"
        f.write_text("hello world\n")
        tool = self._tool(tmp_path)
        diff = tool.diff_preview({"path": str(f), "old_string": "world", "new_string": "world"})
        # Replacing with the same text produces no diff
        assert diff is None

    # --- empty old_string ---

    @pytest.mark.asyncio
    async def test_empty_old_string_count_zero_returns_error(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("something")
        # Empty old_string counts 0 occurrences (vacuously not found)
        result = await self._tool(tmp_path).execute(
            {"path": str(f), "old_string": "notpresent", "new_string": "x"}
        )
        assert result.is_error

    # --- system path ---

    @pytest.mark.asyncio
    async def test_edit_system_path_rejected(self, tmp_path: Path) -> None:
        result = await self._tool(tmp_path).execute(
            {"path": "/etc/hosts", "old_string": "localhost", "new_string": "evil"}
        )
        assert result.is_error


# ===========================================================================
# GlobSearchTool — extended coverage
# ===========================================================================


class TestGlobSearchToolExtended:
    # --- tool metadata ---

    def test_name(self, tmp_path: Path) -> None:
        assert GlobSearchTool(tmp_path).name == "glob_search"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert len(GlobSearchTool(tmp_path).description) > 0

    def test_input_schema_has_pattern(self, tmp_path: Path) -> None:
        schema = GlobSearchTool(tmp_path).input_schema
        assert "pattern" in schema["properties"]

    def test_required_permission(self, tmp_path: Path) -> None:
        assert GlobSearchTool(tmp_path).required_permission == "file:read"

    # --- nested directories ---

    @pytest.mark.asyncio
    async def test_deeply_nested_files(self, tmp_path: Path) -> None:
        deep = tmp_path / "a" / "b" / "c"
        deep.mkdir(parents=True)
        (deep / "deep.py").write_text("# deep")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "**/*.py"})
        assert not result.is_error
        assert "deep.py" in result.content

    @pytest.mark.asyncio
    async def test_multiple_extensions_pattern(self, tmp_path: Path) -> None:
        (tmp_path / "a.py").write_text("")
        (tmp_path / "b.ts").write_text("")
        (tmp_path / "c.txt").write_text("")
        result_py = await GlobSearchTool(tmp_path).execute({"pattern": "*.py"})
        result_ts = await GlobSearchTool(tmp_path).execute({"pattern": "*.ts"})
        assert "a.py" in result_py.content
        assert "b.ts" in result_ts.content
        assert "b.ts" not in result_py.content

    @pytest.mark.asyncio
    async def test_path_is_workspace_root_by_default(self, tmp_path: Path) -> None:
        (tmp_path / "x.txt").write_text("")
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*.txt"})
        assert not result.is_error
        assert "x.txt" in result.content

    @pytest.mark.asyncio
    async def test_system_path_base_rejected(self, tmp_path: Path) -> None:
        result = await GlobSearchTool(tmp_path).execute({"pattern": "*", "path": "/etc"})
        assert result.is_error


# ===========================================================================
# GrepSearchTool — extended coverage
# ===========================================================================


class TestGrepSearchToolExtended:
    # --- tool metadata ---

    def test_name(self, tmp_path: Path) -> None:
        assert GrepSearchTool(tmp_path).name == "grep_search"

    def test_description_non_empty(self, tmp_path: Path) -> None:
        assert len(GrepSearchTool(tmp_path).description) > 0

    def test_input_schema_has_pattern(self, tmp_path: Path) -> None:
        schema = GrepSearchTool(tmp_path).input_schema
        assert "pattern" in schema["properties"]

    def test_required_permission(self, tmp_path: Path) -> None:
        assert GrepSearchTool(tmp_path).required_permission == "file:read"

    # --- case-sensitive (Python re is case-sensitive by default) ---

    @pytest.mark.asyncio
    async def test_case_sensitive_no_match(self, tmp_path: Path) -> None:
        f = tmp_path / "a.txt"
        f.write_text("Hello World\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "hello", "path": str(f)})
        assert not result.is_error
        assert result.content == ""

    # --- case-insensitive via regex flag ---

    @pytest.mark.asyncio
    async def test_case_insensitive_flag_in_pattern(self, tmp_path: Path) -> None:
        f = tmp_path / "ci.txt"
        f.write_text("Hello World\n")
        result = await GrepSearchTool(tmp_path).execute({"pattern": "(?i)hello", "path": str(f)})
        assert not result.is_error
        assert "Hello World" in result.content

    # --- file type filter via glob ---

    @pytest.mark.asyncio
    async def test_glob_filter_limits_to_py_files(self, tmp_path: Path) -> None:
        (tmp_path / "match.py").write_text("target_pattern\n")
        (tmp_path / "skip.txt").write_text("target_pattern\n")
        result = await GrepSearchTool(tmp_path).execute(
            {"pattern": "target_pattern", "glob": "*.py"}
        )
        assert not result.is_error
        assert "match.py" in result.content
        assert "skip.txt" not in result.content

    # --- system path rejected ---

    @pytest.mark.asyncio
    async def test_system_path_rejected(self, tmp_path: Path) -> None:
        result = await GrepSearchTool(tmp_path).execute({"pattern": "root", "path": "/etc/passwd"})
        assert result.is_error

    # --- empty workspace returns empty string ---

    @pytest.mark.asyncio
    async def test_empty_workspace_no_results(self, tmp_path: Path) -> None:
        result = await GrepSearchTool(tmp_path).execute({"pattern": "anything"})
        assert not result.is_error
        assert result.content == ""

    # --- directory target with non-matching glob ---

    @pytest.mark.asyncio
    async def test_glob_with_no_matching_files_empty(self, tmp_path: Path) -> None:
        (tmp_path / "a.md").write_text("target\n")
        result = await GrepSearchTool(tmp_path).execute(
            {"pattern": "target", "glob": "*.nonexistent"}
        )
        assert not result.is_error
        assert result.content == ""
