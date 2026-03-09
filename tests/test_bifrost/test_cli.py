"""Tests for the Bifröst CLI entry point (argument parsing only)."""

from __future__ import annotations

from unittest.mock import patch

from volundr.bifrost.__main__ import (
    _with_auth_mode,
    _with_host,
    _with_port,
    _with_upstream,
)
from volundr.bifrost.config import BifrostConfig


class TestConfigOverrides:
    def test_with_host(self):
        cfg = BifrostConfig()
        updated = _with_host(cfg, "0.0.0.0")
        assert updated.server.host == "0.0.0.0"
        assert cfg.server.host == "127.0.0.1"  # original unchanged

    def test_with_port(self):
        cfg = BifrostConfig()
        updated = _with_port(cfg, 9000)
        assert updated.server.port == 9000

    def test_with_upstream(self):
        cfg = BifrostConfig()
        updated = _with_upstream(cfg, "https://custom.api.com")
        assert updated.upstream.url == "https://custom.api.com"

    def test_with_auth_mode(self):
        cfg = BifrostConfig()
        updated = _with_auth_mode(cfg, "api_key")
        assert updated.upstream.auth.mode == "api_key"


class TestMainParsing:
    @patch("volundr.bifrost.__main__.uvicorn")
    @patch("volundr.bifrost.__main__.load_config")
    def test_main_defaults(self, mock_load_config, mock_uvicorn):
        from volundr.bifrost.__main__ import main

        mock_load_config.return_value = BifrostConfig()
        main([])

        mock_uvicorn.run.assert_called_once()
        call_kwargs = mock_uvicorn.run.call_args
        assert call_kwargs.kwargs["host"] == "127.0.0.1"
        assert call_kwargs.kwargs["port"] == 8200

    @patch("volundr.bifrost.__main__.uvicorn")
    @patch("volundr.bifrost.__main__.load_config")
    def test_main_with_overrides(self, mock_load_config, mock_uvicorn):
        from volundr.bifrost.__main__ import main

        mock_load_config.return_value = BifrostConfig()
        main(["--host", "0.0.0.0", "--port", "9000"])

        call_kwargs = mock_uvicorn.run.call_args
        assert call_kwargs.kwargs["host"] == "0.0.0.0"
        assert call_kwargs.kwargs["port"] == 9000

    @patch("volundr.bifrost.__main__.uvicorn")
    @patch("volundr.bifrost.__main__.load_config")
    def test_main_with_upstream_and_auth(self, mock_load_config, mock_uvicorn):
        from volundr.bifrost.__main__ import main

        mock_load_config.return_value = BifrostConfig()
        main(["--upstream", "https://custom.api.com", "--auth-mode", "api_key"])

        mock_uvicorn.run.assert_called_once()

    @patch("volundr.bifrost.__main__.uvicorn")
    @patch("volundr.bifrost.__main__.load_config")
    def test_main_with_config_file(self, mock_load_config, mock_uvicorn):
        from volundr.bifrost.__main__ import main

        mock_load_config.return_value = BifrostConfig()
        main(["--config", "/tmp/test.yaml"])

        mock_load_config.assert_called_once_with("/tmp/test.yaml")
