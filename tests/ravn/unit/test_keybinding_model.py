"""Unit tests for keybinding model — vim/emacs key conversion and KeybindingMap."""

from __future__ import annotations

from ravn.tui.keybindings.model import (
    KeybindingMap,
    emacs_kbd_to_textual,
    emacs_key_to_textual,
    vim_key_to_textual,
    vim_sequence_to_textual,
)

# ---------------------------------------------------------------------------
# vim_key_to_textual
# ---------------------------------------------------------------------------


class TestVimKeyToTextual:
    def test_escape(self) -> None:
        assert vim_key_to_textual("<Esc>") == "escape"

    def test_enter(self) -> None:
        assert vim_key_to_textual("<CR>") == "enter"
        assert vim_key_to_textual("<Return>") == "enter"

    def test_space(self) -> None:
        assert vim_key_to_textual("<Space>") == "space"

    def test_tab(self) -> None:
        assert vim_key_to_textual("<Tab>") == "tab"

    def test_backspace(self) -> None:
        assert vim_key_to_textual("<BS>") == "backspace"

    def test_ctrl_notation(self) -> None:
        assert vim_key_to_textual("<C-w>") == "ctrl+w"
        assert vim_key_to_textual("<C-x>") == "ctrl+x"

    def test_alt_notation(self) -> None:
        assert vim_key_to_textual("<M-x>") == "alt+x"
        assert vim_key_to_textual("<A-x>") == "alt+x"

    def test_plain_char(self) -> None:
        assert vim_key_to_textual("j") == "j"
        assert vim_key_to_textual("k") == "k"

    def test_leader_returns_none(self) -> None:
        assert vim_key_to_textual("<leader>") is None

    def test_unmapped_notation_returns_none(self) -> None:
        assert vim_key_to_textual("<Unmapped>") is None

    def test_angle_brackets_in_single_char_returns_none(self) -> None:
        assert vim_key_to_textual("<") is None

    def test_function_keys(self) -> None:
        assert vim_key_to_textual("<F1>") == "f1"
        assert vim_key_to_textual("<F12>") == "f12"

    def test_arrow_keys(self) -> None:
        assert vim_key_to_textual("<Up>") == "up"
        assert vim_key_to_textual("<Down>") == "down"
        assert vim_key_to_textual("<Left>") == "left"
        assert vim_key_to_textual("<Right>") == "right"


# ---------------------------------------------------------------------------
# vim_sequence_to_textual
# ---------------------------------------------------------------------------


class TestVimSequenceToTextual:
    def test_single_ctrl(self) -> None:
        assert vim_sequence_to_textual("<C-w>") == ["ctrl+w"]

    def test_two_key_sequence(self) -> None:
        assert vim_sequence_to_textual("<C-w>h") == ["ctrl+w", "h"]

    def test_double_char(self) -> None:
        assert vim_sequence_to_textual("gg") == ["g", "g"]

    def test_empty_string_returns_none(self) -> None:
        assert vim_sequence_to_textual("") is None

    def test_leader_in_seq_returns_none(self) -> None:
        assert vim_sequence_to_textual("<leader>j") is None

    def test_unclosed_bracket_handled(self) -> None:
        # Unclosed "<" treated as plain char
        result = vim_sequence_to_textual("<w")
        # "<" returns None → whole sequence returns None
        assert result is None


# ---------------------------------------------------------------------------
# emacs_key_to_textual
# ---------------------------------------------------------------------------


class TestEmacsKeyToTextual:
    def test_enter(self) -> None:
        assert emacs_key_to_textual("RET") == "enter"

    def test_escape(self) -> None:
        assert emacs_key_to_textual("ESC") == "escape"

    def test_space(self) -> None:
        assert emacs_key_to_textual("SPC") == "space"

    def test_ctrl_notation(self) -> None:
        assert emacs_key_to_textual("C-h") == "ctrl+h"
        assert emacs_key_to_textual("C-x") == "ctrl+x"

    def test_meta_notation(self) -> None:
        assert emacs_key_to_textual("M-x") == "alt+x"

    def test_plain_char(self) -> None:
        assert emacs_key_to_textual("a") == "a"

    def test_unknown_multi_char_returns_none(self) -> None:
        assert emacs_key_to_textual("UNKNOWN") is None

    def test_arrow_keys(self) -> None:
        assert emacs_key_to_textual("up") == "up"
        assert emacs_key_to_textual("down") == "down"


# ---------------------------------------------------------------------------
# emacs_kbd_to_textual
# ---------------------------------------------------------------------------


class TestEmacsKbdToTextual:
    def test_single_key(self) -> None:
        assert emacs_kbd_to_textual("C-h") == ["ctrl+h"]

    def test_chord(self) -> None:
        assert emacs_kbd_to_textual("C-x C-f") == ["ctrl+x", "ctrl+f"]

    def test_empty_returns_none(self) -> None:
        assert emacs_kbd_to_textual("") is None
        assert emacs_kbd_to_textual("   ") is None

    def test_unknown_key_returns_none(self) -> None:
        assert emacs_kbd_to_textual("UNKNOWN") is None


# ---------------------------------------------------------------------------
# KeybindingMap
# ---------------------------------------------------------------------------


class TestKeybindingMap:
    def test_register_single_key(self) -> None:
        km = KeybindingMap()
        km.register(["j"], "select_next")
        assert km.single_key["j"] == "select_next"

    def test_register_multi_key(self) -> None:
        km = KeybindingMap()
        km.register(["ctrl+w", "v"], "split_vert")
        assert len(km.multi_key) == 1
        assert km.multi_key[0] == (["ctrl+w", "v"], "split_vert")

    def test_register_empty_sequence_noop(self) -> None:
        km = KeybindingMap()
        km.register([], "noop")
        assert km.single_key == {}
        assert km.multi_key == []

    def test_register_overrides_single_key(self) -> None:
        km = KeybindingMap()
        km.register(["j"], "original")
        km.register(["j"], "override")
        assert km.single_key["j"] == "override"

    def test_register_vim_rhs_known_action(self) -> None:
        km = KeybindingMap()
        action_map = {"<C-w>v": "split_vert"}
        result = km.register_vim_rhs(["ctrl+w", "v"], "<C-w>v", action_map)
        assert result is True
        assert km.multi_key[0] == (["ctrl+w", "v"], "split_vert")

    def test_register_vim_rhs_unknown_action(self) -> None:
        km = KeybindingMap()
        result = km.register_vim_rhs(["ctrl+w", "v"], "<C-w>z", {})
        assert result is False
        assert km.multi_key == []

    def test_warn_accumulates(self) -> None:
        km = KeybindingMap()
        km.warn("first warning")
        km.warn("second warning")
        assert km.warnings == ["first warning", "second warning"]

    def test_warnings_property_returns_copy(self) -> None:
        km = KeybindingMap()
        km.warn("test")
        w1 = km.warnings
        w1.append("extra")
        assert len(km.warnings) == 1  # original not mutated
