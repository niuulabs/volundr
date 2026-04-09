"""Unit tests for KeybindingConfig and KeybindingLoader."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ravn.tui.keybindings.loader import KeybindingConfig, KeybindingLoader
from ravn.tui.keybindings.model import KeybindingMap


# ---------------------------------------------------------------------------
# KeybindingConfig.from_dict
# ---------------------------------------------------------------------------


class TestKeybindingConfigFromDict:
    def test_defaults_when_empty(self) -> None:
        cfg = KeybindingConfig.from_dict({})
        assert cfg.source == "vim"
        assert cfg.config_path is None
        assert cfg.overrides == {}
        assert cfg.disabled == []

    def test_source_read(self) -> None:
        cfg = KeybindingConfig.from_dict({"keybindings": {"source": "emacs"}})
        assert cfg.source == "emacs"

    def test_config_path_read(self) -> None:
        cfg = KeybindingConfig.from_dict({"keybindings": {"config_path": "/tmp/init.vim"}})
        assert cfg.config_path == "/tmp/init.vim"

    def test_overrides_read(self) -> None:
        data = {"keybindings": {"overrides": {"ctrl+h": "focus_left"}}}
        cfg = KeybindingConfig.from_dict(data)
        assert cfg.overrides == {"ctrl+h": "focus_left"}

    def test_disabled_read(self) -> None:
        data = {"keybindings": {"disabled": ["ctrl+c", "ctrl+z"]}}
        cfg = KeybindingConfig.from_dict(data)
        assert cfg.disabled == ["ctrl+c", "ctrl+z"]

    def test_null_keybindings_key_gives_defaults(self) -> None:
        cfg = KeybindingConfig.from_dict({"keybindings": None})
        assert cfg.source == "vim"

    def test_source_coerced_to_str(self) -> None:
        # Edge: numeric source (unlikely but defensive)
        cfg = KeybindingConfig.from_dict({"keybindings": {"source": 42}})
        assert cfg.source == "42"


# ---------------------------------------------------------------------------
# KeybindingConfig.load_from_file
# ---------------------------------------------------------------------------


class TestKeybindingConfigLoadFromFile:
    def test_reads_yaml_file(self, tmp_path: Path) -> None:
        f = tmp_path / "tui.yaml"
        f.write_text("keybindings:\n  source: nvim\n")
        cfg = KeybindingConfig.load_from_file(f)
        assert cfg.source == "nvim"

    def test_missing_file_returns_defaults(self, tmp_path: Path) -> None:
        cfg = KeybindingConfig.load_from_file(tmp_path / "nonexistent.yaml")
        assert cfg.source == "vim"

    def test_empty_yaml_returns_defaults(self, tmp_path: Path) -> None:
        f = tmp_path / "tui.yaml"
        f.write_text("")
        cfg = KeybindingConfig.load_from_file(f)
        assert cfg.source == "vim"

    def test_yaml_import_error_returns_defaults(self, tmp_path: Path) -> None:
        f = tmp_path / "tui.yaml"
        f.write_text("keybindings:\n  source: emacs\n")
        with patch.dict("sys.modules", {"yaml": None}):
            cfg = KeybindingConfig.load_from_file(f)
        assert cfg.source == "vim"

    def test_malformed_yaml_returns_defaults(self, tmp_path: Path) -> None:
        f = tmp_path / "tui.yaml"
        f.write_text(":\t:\n  bad: [unclosed")
        cfg = KeybindingConfig.load_from_file(f)
        assert cfg.source == "vim"


# ---------------------------------------------------------------------------
# KeybindingLoader._resolved_path
# ---------------------------------------------------------------------------


class TestKeybindingLoaderResolvedPath:
    def test_returns_none_when_no_config_path(self) -> None:
        loader = KeybindingLoader(config=KeybindingConfig())
        assert loader._resolved_path() is None

    def test_returns_path_when_file_exists(self, tmp_path: Path) -> None:
        f = tmp_path / "init.vim"
        f.write_text("nnoremap <C-h> <C-w>h\n")
        cfg = KeybindingConfig(config_path=str(f))
        loader = KeybindingLoader(config=cfg)
        assert loader._resolved_path() == f

    def test_returns_none_when_file_missing(self, tmp_path: Path) -> None:
        cfg = KeybindingConfig(config_path=str(tmp_path / "missing.vim"))
        loader = KeybindingLoader(config=cfg)
        assert loader._resolved_path() is None


# ---------------------------------------------------------------------------
# KeybindingLoader._parse_editor
# ---------------------------------------------------------------------------


class TestKeybindingLoaderParseEditor:
    def _loader(self) -> KeybindingLoader:
        return KeybindingLoader(config=KeybindingConfig())

    def test_unknown_source_returns_zero(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        assert loader._parse_editor("unknown_editor", kb) == 0

    def test_none_source_returns_zero(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        assert loader._parse_editor("none", kb) == 0

    def test_custom_source_returns_zero(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        assert loader._parse_editor("custom", kb) == 0

    def test_vim_source_calls_load_vim(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        with patch.object(loader, "_load_vim", return_value=3) as mock_load:
            result = loader._parse_editor("vim", kb)
        mock_load.assert_called_once_with(kb)
        assert result == 3

    def test_nvim_source_calls_load_nvim(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        with patch.object(loader, "_load_nvim", return_value=2) as mock_load:
            result = loader._parse_editor("nvim", kb)
        mock_load.assert_called_once_with(kb)
        assert result == 2

    def test_neovim_alias_calls_load_nvim(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        with patch.object(loader, "_load_nvim", return_value=1) as mock_load:
            result = loader._parse_editor("neovim", kb)
        mock_load.assert_called_once_with(kb)
        assert result == 1

    def test_emacs_source_calls_load_emacs(self) -> None:
        loader = self._loader()
        kb = KeybindingMap()
        with patch.object(loader, "_load_emacs", return_value=4) as mock_load:
            result = loader._parse_editor("emacs", kb)
        mock_load.assert_called_once_with(kb)
        assert result == 4


# ---------------------------------------------------------------------------
# KeybindingLoader.load — overrides and disabled
# ---------------------------------------------------------------------------


class TestKeybindingLoaderLoad:
    def test_overrides_applied(self) -> None:
        cfg = KeybindingConfig(source="none", overrides={"ctrl+h": "focus_left"})
        loader = KeybindingLoader(config=cfg)
        kb = loader.load()
        assert kb.single_key.get("ctrl+h") == "focus_left"

    def test_source_override_param(self) -> None:
        """load(source=...) overrides config.source."""
        cfg = KeybindingConfig(source="emacs")
        loader = KeybindingLoader(config=cfg)
        with patch.object(loader, "_load_vim", return_value=0) as mock_vim, \
             patch.object(loader, "_load_emacs", return_value=0) as mock_emacs:
            loader.load(source="vim")
        mock_vim.assert_called_once()
        mock_emacs.assert_not_called()

    def test_load_returns_keybinding_map(self) -> None:
        cfg = KeybindingConfig(source="none")
        loader = KeybindingLoader(config=cfg)
        result = loader.load()
        assert isinstance(result, KeybindingMap)

    def test_multiple_overrides_all_applied(self) -> None:
        cfg = KeybindingConfig(
            source="none",
            overrides={"ctrl+h": "focus_left", "ctrl+l": "focus_right"},
        )
        loader = KeybindingLoader(config=cfg)
        kb = loader.load()
        assert kb.single_key.get("ctrl+h") == "focus_left"
        assert kb.single_key.get("ctrl+l") == "focus_right"


# ---------------------------------------------------------------------------
# KeybindingLoader._load_vim
# ---------------------------------------------------------------------------


class TestKeybindingLoaderLoadVim:
    def test_uses_config_path_when_provided(self, tmp_path: Path) -> None:
        f = tmp_path / "init.vim"
        f.write_text("nnoremap <C-h> <C-w>h\n")
        cfg = KeybindingConfig(source="vim", config_path=str(f))
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        added = loader._load_vim(kb)
        assert added >= 1
        assert kb.single_key.get("ctrl+h") == "focus_left"

    def test_returns_zero_when_no_config_found(self) -> None:
        cfg = KeybindingConfig(source="vim")
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        with patch("ravn.tui.keybindings.vim.find_vimrc", return_value=None), \
             patch("ravn.tui.keybindings.nvim.find_nvim_config", return_value=None):
            added = loader._load_vim(kb)
        assert added == 0

    def test_lua_file_uses_nvim_parser(self, tmp_path: Path) -> None:
        f = tmp_path / "init.lua"
        f.write_text('vim.keymap.set("n", "<C-h>", "<C-w>h")\n')
        cfg = KeybindingConfig(source="vim", config_path=str(f))
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        added = loader._load_vim(kb)
        assert added >= 1


# ---------------------------------------------------------------------------
# KeybindingLoader._load_nvim
# ---------------------------------------------------------------------------


class TestKeybindingLoaderLoadNvim:
    def test_uses_config_path_when_provided(self, tmp_path: Path) -> None:
        f = tmp_path / "init.lua"
        f.write_text('vim.keymap.set("n", "<C-h>", "<C-w>h")\n')
        cfg = KeybindingConfig(source="nvim", config_path=str(f))
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        added = loader._load_nvim(kb)
        assert added >= 1

    def test_returns_zero_when_no_config_found(self) -> None:
        cfg = KeybindingConfig(source="nvim")
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        with patch("ravn.tui.keybindings.nvim.find_nvim_config", return_value=None):
            added = loader._load_nvim(kb)
        assert added == 0


# ---------------------------------------------------------------------------
# KeybindingLoader._load_emacs
# ---------------------------------------------------------------------------


class TestKeybindingLoaderLoadEmacs:
    def test_uses_config_path_when_provided(self, tmp_path: Path) -> None:
        f = tmp_path / "init.el"
        f.write_text('(global-set-key (kbd "C-h") \'evil-window-left)\n')
        cfg = KeybindingConfig(source="emacs", config_path=str(f))
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        added = loader._load_emacs(kb)
        assert added >= 1

    def test_returns_zero_when_no_config_found(self) -> None:
        cfg = KeybindingConfig(source="emacs")
        loader = KeybindingLoader(config=cfg)
        kb = KeybindingMap()
        with patch("ravn.tui.keybindings.emacs.find_emacs_config", return_value=None):
            added = loader._load_emacs(kb)
        assert added == 0


# ---------------------------------------------------------------------------
# KeybindingLoader constructor — auto-loads tui.yaml when present
# ---------------------------------------------------------------------------


class TestKeybindingLoaderInit:
    def test_uses_provided_config(self) -> None:
        cfg = KeybindingConfig(source="emacs")
        loader = KeybindingLoader(config=cfg)
        assert loader._config.source == "emacs"

    def test_loads_tui_config_when_exists(self, tmp_path: Path) -> None:
        tui_yaml = tmp_path / "tui.yaml"
        tui_yaml.write_text("keybindings:\n  source: emacs\n")
        with patch("ravn.tui.keybindings.loader._TUI_CONFIG", tui_yaml):
            loader = KeybindingLoader()
        assert loader._config.source == "emacs"

    def test_uses_defaults_when_no_tui_yaml(self, tmp_path: Path) -> None:
        missing = tmp_path / "no_such_tui.yaml"
        with patch("ravn.tui.keybindings.loader._TUI_CONFIG", missing):
            loader = KeybindingLoader()
        assert loader._config.source == "vim"
