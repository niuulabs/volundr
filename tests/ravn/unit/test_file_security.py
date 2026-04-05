"""Unit tests for file_security utilities."""

from __future__ import annotations

from pathlib import Path

import pytest

from ravn.adapters.file_security import (
    DEFAULT_BINARY_CHECK_BYTES,
    DEFAULT_MAX_READ_BYTES,
    DEFAULT_MAX_WRITE_BYTES,
    PathSecurityError,
    _assert_not_system,
    is_binary,
    resolve_safe,
)


class TestDefaults:
    def test_max_read_bytes(self) -> None:
        assert DEFAULT_MAX_READ_BYTES == 1 * 1024 * 1024

    def test_max_write_bytes(self) -> None:
        assert DEFAULT_MAX_WRITE_BYTES == 5 * 1024 * 1024

    def test_binary_check_bytes(self) -> None:
        assert DEFAULT_BINARY_CHECK_BYTES == 8 * 1024


class TestResolveSafe:
    def test_safe_path_within_workspace(self, tmp_path: Path) -> None:
        target = tmp_path / "file.txt"
        result = resolve_safe(str(target), tmp_path)
        assert result == target.resolve()

    def test_path_escaping_workspace_raises(self, tmp_path: Path) -> None:
        parent = tmp_path.parent
        escaped = parent / "other"
        with pytest.raises(PathSecurityError, match="outside the workspace"):
            resolve_safe(str(escaped), tmp_path)

    def test_traversal_attack_raises(self, tmp_path: Path) -> None:
        traversal = tmp_path / ".." / ".." / "etc" / "passwd"
        with pytest.raises(PathSecurityError):
            resolve_safe(str(traversal), tmp_path)

    def test_path_object_accepted(self, tmp_path: Path) -> None:
        target = tmp_path / "a.txt"
        result = resolve_safe(target, tmp_path)
        assert result == target.resolve()

    def test_non_existent_path_allowed(self, tmp_path: Path) -> None:
        # Path need not exist — useful for write targets
        result = resolve_safe(str(tmp_path / "new_file.txt"), tmp_path)
        assert result == (tmp_path / "new_file.txt").resolve()


class TestIsBinary:
    def test_text_data_not_binary(self) -> None:
        assert not is_binary(b"Hello, world!\n")

    def test_nul_byte_is_binary(self) -> None:
        assert is_binary(b"text\x00data")

    def test_empty_bytes_not_binary(self) -> None:
        assert not is_binary(b"")

    def test_only_nul_is_binary(self) -> None:
        assert is_binary(b"\x00")

    def test_nul_beyond_check_window_not_binary(self) -> None:
        # NUL byte is beyond the check_bytes window — should not be detected
        data = b"a" * 100 + b"\x00"
        assert not is_binary(data, check_bytes=100)

    def test_nul_within_check_window_is_binary(self) -> None:
        data = b"a" * 10 + b"\x00" + b"b" * 100
        assert is_binary(data, check_bytes=50)

    def test_unicode_text_not_binary(self) -> None:
        assert not is_binary("Hello, 世界!".encode())


class TestAssertNotSystem:
    """Tests for _assert_not_system directly (bypasses workspace check)."""

    def test_system_etc_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/etc/passwd"))

    def test_system_usr_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/usr/bin/python"))

    def test_system_var_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/var/log/syslog"))

    def test_system_proc_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/proc/cpuinfo"))

    def test_system_sys_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/sys/kernel"))

    def test_system_boot_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/boot/vmlinuz"))

    def test_system_prefix_exact_match_raises(self) -> None:
        with pytest.raises(PathSecurityError, match="system path"):
            _assert_not_system(Path("/etc"))

    def test_non_system_path_allowed(self, tmp_path: Path) -> None:
        # Should not raise for a normal path
        _assert_not_system(tmp_path)

    def test_home_path_allowed(self) -> None:
        _assert_not_system(Path("/home/user/project"))
