"""Unit tests for keybinding parsers: VimscriptParser, NvimLuaParser, EmacsParser."""

from __future__ import annotations

from pathlib import Path

from ravn.tui.keybindings.model import KeybindingMap
from ravn.tui.keybindings.vim import VimscriptParser
from ravn.tui.keybindings.nvim import NvimLuaParser
from ravn.tui.keybindings.emacs import EmacsParser


# ---------------------------------------------------------------------------
# VimscriptParser
# ---------------------------------------------------------------------------


class TestVimscriptParser:
    def test_parse_nnoremap(self) -> None:
        content = "nnoremap <C-w>v <C-w>v\n"
        result = VimscriptParser().parse(content)
        assert "<C-w>v" in result

    def test_parse_noremap(self) -> None:
        content = "noremap <C-h> <C-w>h\n"
        result = VimscriptParser().parse(content)
        assert "<C-h>" in result
        assert result["<C-h>"] == "<C-w>h"

    def test_parse_nmap(self) -> None:
        content = "nmap <C-j> <C-w>j\n"
        result = VimscriptParser().parse(content)
        assert "<C-j>" in result

    def test_ignore_non_remap_lines(self) -> None:
        content = "set number\nset relativenumber\n"
        result = VimscriptParser().parse(content)
        assert result == {}

    def test_strip_inline_comment(self) -> None:
        content = 'nnoremap <C-h> <C-w>h  " move left\n'
        result = VimscriptParser().parse(content)
        assert "<C-h>" in result

    def test_apply_to_map_adds_known_binding(self, tmp_path: Path) -> None:
        vimrc = tmp_path / ".vimrc"
        vimrc.write_text("nnoremap <C-h> <C-w>h\n")
        kb = KeybindingMap()
        added = VimscriptParser().apply_to_map(vimrc, kb)
        assert added == 1
        assert kb.single_key.get("ctrl+h") == "focus_left"

    def test_apply_to_map_ignores_unknown_rhs(self, tmp_path: Path) -> None:
        vimrc = tmp_path / ".vimrc"
        vimrc.write_text("nnoremap <C-z> :SomeCustomCommand<CR>\n")
        kb = KeybindingMap()
        added = VimscriptParser().apply_to_map(vimrc, kb)
        assert added == 0

    def test_apply_to_map_chaining(self, tmp_path: Path) -> None:
        """LHS → custom RHS → known TUI action via chaining."""
        vimrc = tmp_path / ".vimrc"
        vimrc.write_text(
            "nnoremap <C-h> <C-w>h\n"
            "nnoremap <M-h> <C-h>\n"  # chains through <C-h> → <C-w>h → focus_left
        )
        kb = KeybindingMap()
        added = VimscriptParser().apply_to_map(vimrc, kb)
        assert added >= 1

    def test_apply_to_map_missing_file_returns_zero(self, tmp_path: Path) -> None:
        kb = KeybindingMap()
        added = VimscriptParser().apply_to_map(tmp_path / "nonexistent.vimrc", kb)
        assert added == 0

    def test_apply_to_map_unconvertible_lhs_warns(self, tmp_path: Path) -> None:
        vimrc = tmp_path / ".vimrc"
        vimrc.write_text("nnoremap <leader>h <C-w>h\n")
        kb = KeybindingMap()
        VimscriptParser().apply_to_map(vimrc, kb)
        assert len(kb.warnings) == 1
        assert "vim" in kb.warnings[0]


# ---------------------------------------------------------------------------
# NvimLuaParser
# ---------------------------------------------------------------------------


class TestNvimLuaParser:
    def _lua_keymap(self, lhs: str, rhs: str) -> str:
        return f'vim.keymap.set("n", "{lhs}", "{rhs}")\n'

    def test_parse_keymap_set(self) -> None:
        content = self._lua_keymap("<C-h>", "<C-w>h")
        result = NvimLuaParser().parse(content)
        assert "<C-h>" in result
        assert result["<C-h>"] == "<C-w>h"

    def test_parse_nvim_set_keymap(self) -> None:
        content = 'vim.api.nvim_set_keymap("n", "<C-j>", "<C-w>j", {})\n'
        result = NvimLuaParser().parse(content)
        assert "<C-j>" in result

    def test_apply_to_map_adds_known_binding(self, tmp_path: Path) -> None:
        init_lua = tmp_path / "init.lua"
        init_lua.write_text(self._lua_keymap("<C-h>", "<C-w>h"))
        kb = KeybindingMap()
        added = NvimLuaParser().apply_to_map(init_lua, kb)
        assert added == 1
        assert kb.single_key.get("ctrl+h") == "focus_left"

    def test_apply_to_map_ignores_unknown(self, tmp_path: Path) -> None:
        init_lua = tmp_path / "init.lua"
        init_lua.write_text(self._lua_keymap("<C-z>", ":MyCustomCommand<CR>"))
        kb = KeybindingMap()
        added = NvimLuaParser().apply_to_map(init_lua, kb)
        assert added == 0

    def test_apply_to_map_missing_file_returns_zero(self, tmp_path: Path) -> None:
        kb = KeybindingMap()
        added = NvimLuaParser().apply_to_map(tmp_path / "nonexistent.lua", kb)
        assert added == 0

    def test_parse_file_vim_extension_uses_vimscript_parser(self, tmp_path: Path) -> None:
        init_vim = tmp_path / "init.vim"
        init_vim.write_text("nnoremap <C-h> <C-w>h\n")
        result = NvimLuaParser().parse_file(init_vim)
        assert "<C-h>" in result

    def test_apply_to_map_unconvertible_lhs_warns(self, tmp_path: Path) -> None:
        init_lua = tmp_path / "init.lua"
        init_lua.write_text(self._lua_keymap("<leader>h", "<C-w>h"))
        kb = KeybindingMap()
        NvimLuaParser().apply_to_map(init_lua, kb)
        assert len(kb.warnings) == 1
        assert "nvim" in kb.warnings[0]


# ---------------------------------------------------------------------------
# EmacsParser
# ---------------------------------------------------------------------------


class TestEmacsParser:
    def test_parse_global_set_key(self) -> None:
        content = "(global-set-key (kbd \"C-h\") 'evil-window-left)\n"
        result = EmacsParser().parse(content)
        assert "C-h" in result
        assert result["C-h"] == "evil-window-left"

    def test_parse_define_key(self) -> None:
        content = '(define-key evil-normal-state-map (kbd "C-j") \'evil-window-down)\n'
        result = EmacsParser().parse(content)
        assert "C-j" in result

    def test_parse_evil_define_key(self) -> None:
        content = "(evil-define-key 'normal evil-normal-state-map (kbd \"C-l\") 'evil-window-right)\n"
        result = EmacsParser().parse(content)
        assert "C-l" in result

    def test_apply_to_map_adds_known_binding(self, tmp_path: Path) -> None:
        init_el = tmp_path / "init.el"
        init_el.write_text("(global-set-key (kbd \"C-h\") 'evil-window-left)\n")
        kb = KeybindingMap()
        added = EmacsParser().apply_to_map(init_el, kb)
        assert added == 1
        assert kb.single_key.get("ctrl+h") == "focus_left"

    def test_apply_to_map_ignores_unknown_command(self, tmp_path: Path) -> None:
        init_el = tmp_path / "init.el"
        init_el.write_text("(global-set-key (kbd \"C-z\") 'some-custom-command)\n")
        kb = KeybindingMap()
        added = EmacsParser().apply_to_map(init_el, kb)
        assert added == 0

    def test_apply_to_map_missing_file_returns_zero(self, tmp_path: Path) -> None:
        kb = KeybindingMap()
        added = EmacsParser().apply_to_map(tmp_path / "nonexistent.el", kb)
        assert added == 0

    def test_apply_to_map_vanilla_emacs_next_line(self, tmp_path: Path) -> None:
        init_el = tmp_path / "init.el"
        init_el.write_text("(global-set-key (kbd \"C-n\") 'next-line)\n")
        kb = KeybindingMap()
        added = EmacsParser().apply_to_map(init_el, kb)
        assert added == 1
        assert kb.single_key.get("ctrl+n") == "scroll_down"
