"""Extended tests for cli.build — Nuitka build script, main command, and _copy_pgserver_dylibs."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from cli.build import (
    DATA_DIR_MAPPINGS,
    _copy_pgserver_dylibs,
    build_cli,
    build_command,
    platform_suffix,
)

runner = CliRunner()


class TestPlatformSuffixNormalization:
    """Tests for architecture name normalization."""

    def test_x86_64_normalised_to_amd64(self) -> None:
        with patch("cli.build.platform.machine", return_value="x86_64"):
            result = platform_suffix()
        assert "amd64" in result

    def test_aarch64_normalised_to_arm64(self) -> None:
        with patch("cli.build.platform.machine", return_value="aarch64"):
            result = platform_suffix()
        assert "arm64" in result

    def test_arm64_stays_arm64(self) -> None:
        with patch("cli.build.platform.machine", return_value="arm64"):
            result = platform_suffix()
        assert "arm64" in result

    def test_unknown_arch_passed_through(self) -> None:
        with patch("cli.build.platform.machine", return_value="riscv64"):
            result = platform_suffix()
        assert "riscv64" in result

    def test_os_name_lowered(self) -> None:
        with patch("cli.build.platform.system", return_value="Linux"):
            result = platform_suffix()
        assert result.startswith("linux-")


class TestBuildCommandDataDirs:
    """Tests for data directory inclusion in build_command."""

    def test_skips_empty_data_dirs(self) -> None:
        with patch.object(Path, "is_dir", return_value=False):
            cmd = build_command()
        # None of the data dir mappings should appear
        cmd_str = " ".join(cmd)
        for src_dir, dest in DATA_DIR_MAPPINGS:
            assert f"={dest}" not in cmd_str or "--include-data-dir" not in cmd_str

    def test_includes_populated_data_dirs(self, tmp_path: Path) -> None:
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "file.txt").write_text("content")

        with patch(
            "cli.build.DATA_DIR_MAPPINGS",
            [(data_dir, "cli/test/data")],
        ):
            cmd = build_command()

        cmd_str = " ".join(cmd)
        assert "--include-data-dir=" in cmd_str
        assert "cli/test/data" in cmd_str


class TestBuildCommandPgserver:
    """Tests for pgserver binary inclusion."""

    def test_includes_pgserver_dylib_files(self, tmp_path: Path) -> None:
        pg_root = tmp_path / "pgserver"
        pg_root.mkdir()
        (pg_root / "__init__.py").write_text("")
        lib_dir = pg_root / "lib"
        lib_dir.mkdir()
        (lib_dir / "libpq.dylib").write_text("binary")
        (lib_dir / "libpq.so").write_text("binary")
        (lib_dir / "some.py").write_text("python")

        mock_pgserver = MagicMock()
        mock_pgserver.__file__ = str(pg_root / "__init__.py")

        with (
            patch.dict("sys.modules", {"pgserver": mock_pgserver}),
            patch("cli.build.DATA_DIR_MAPPINGS", []),
        ):
            cmd = build_command()

        cmd_str = " ".join(cmd)
        assert "libpq.dylib" in cmd_str
        assert "libpq.so" in cmd_str
        # Python files should NOT be included (handled by --include-package)
        assert "some.py" not in cmd_str

    def test_skips_pgserver_when_not_installed(self) -> None:
        with (
            patch("cli.build.DATA_DIR_MAPPINGS", []),
            patch.dict("sys.modules", {"pgserver": None}),
            patch("builtins.__import__", side_effect=ImportError("no pgserver")),
        ):
            # Should not raise
            cmd = build_command()
        assert isinstance(cmd, list)


class TestCopyPgserverDylibs:
    """Tests for _copy_pgserver_dylibs()."""

    def test_skips_when_target_exists(self, tmp_path: Path) -> None:
        dist = tmp_path / "__main__.dist" / "pgserver" / ".dylibs"
        dist.mkdir(parents=True)
        # Should be a no-op
        _copy_pgserver_dylibs(str(tmp_path))

    def test_copies_dylibs_from_pgserver(self, tmp_path: Path) -> None:
        # Source
        pg_root = tmp_path / "pgserver_src"
        pg_root.mkdir()
        (pg_root / "__init__.py").write_text("")
        dylibs = pg_root / ".dylibs"
        dylibs.mkdir()
        (dylibs / "libpq.5.dylib").write_text("binary")

        # Target
        output = tmp_path / "output"
        dist = output / "__main__.dist" / "pgserver"
        dist.mkdir(parents=True)

        mock_pgserver = MagicMock()
        mock_pgserver.__file__ = str(pg_root / "__init__.py")

        with patch.dict("sys.modules", {"pgserver": mock_pgserver}):
            _copy_pgserver_dylibs(str(output))

        target = output / "__main__.dist" / "pgserver" / ".dylibs"
        assert target.is_dir()
        assert (target / "libpq.5.dylib").exists()

    def test_handles_missing_pgserver_gracefully(self, tmp_path: Path) -> None:
        output = tmp_path / "output"
        dist = output / "__main__.dist" / "pgserver"
        dist.mkdir(parents=True)

        builtin_import = getattr(__builtins__, "__import__", __import__)

        def selective_import(name, *args, **kwargs):
            if name == "pgserver":
                raise ImportError("no pgserver")
            return builtin_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=selective_import):
            # Should not raise
            _copy_pgserver_dylibs(str(output))


class TestBuildCliMain:
    """Tests for the build_cli main command (non-dry-run paths)."""

    def test_main_run_fails(self) -> None:
        with patch("cli.build.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)
            result = runner.invoke(build_cli, ["--name", "test-bin", "--output-dir", "/tmp/out"])
        assert result.exit_code == 1

    def test_main_run_succeeds(self, tmp_path: Path) -> None:
        output_dir = str(tmp_path / "dist")
        with (
            patch("cli.build.subprocess.run") as mock_run,
            patch("cli.build._copy_pgserver_dylibs") as mock_copy,
        ):
            mock_run.return_value = MagicMock(returncode=0)
            result = runner.invoke(build_cli, ["--name", "test-bin", "--output-dir", output_dir])
        assert result.exit_code == 0
        mock_copy.assert_called_once_with(output_dir)

    def test_dry_run_prints_command(self) -> None:
        result = runner.invoke(build_cli, ["--dry-run"])
        assert result.exit_code == 0
        assert "nuitka" in result.output
