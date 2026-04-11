"""Tests for cli.main — entry point dispatching."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch


class TestMainFunction:
    """Tests for the main() function in cli.main."""

    def test_main_sets_default_config_when_exists(self, tmp_path: Path) -> None:
        config_file = tmp_path / ".niuu" / "config.yaml"
        config_file.parent.mkdir(parents=True)
        config_file.write_text("mode: mini\n")

        captured_env: dict[str, str] = {}

        def capture_app():
            """Capture NIUU_CONFIG when app() is called."""
            captured_env["NIUU_CONFIG"] = os.environ.get("NIUU_CONFIG", "")

        mock_app = MagicMock(side_effect=capture_app)

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.main.Path.home", return_value=tmp_path),
            patch("cli.app.build_app", return_value=mock_app),
        ):
            from cli.main import main

            main()

        assert captured_env["NIUU_CONFIG"] == str(config_file)

    def test_main_skips_default_when_niuu_config_set(self) -> None:
        captured_env: dict[str, str] = {}

        def capture_app():
            captured_env["NIUU_CONFIG"] = os.environ.get("NIUU_CONFIG", "")

        mock_app = MagicMock(side_effect=capture_app)

        with (
            patch.dict(os.environ, {"NIUU_CONFIG": "/custom/config.yaml"}, clear=True),
            patch("cli.app.build_app", return_value=mock_app),
        ):
            from cli.main import main

            main()

        # Should not have changed NIUU_CONFIG from the original value
        assert captured_env["NIUU_CONFIG"] == "/custom/config.yaml"

    def test_main_skips_default_when_config_does_not_exist(self, tmp_path: Path) -> None:
        captured_env: dict[str, str | None] = {}

        def capture_app():
            captured_env["NIUU_CONFIG"] = os.environ.get("NIUU_CONFIG")

        mock_app = MagicMock(side_effect=capture_app)

        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.main.Path.home", return_value=tmp_path),
            patch("cli.app.build_app", return_value=mock_app),
        ):
            from cli.main import main

            main()

        # NIUU_CONFIG should not be set if default doesn't exist
        assert captured_env["NIUU_CONFIG"] is None
