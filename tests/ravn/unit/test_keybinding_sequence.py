"""Unit tests for KeySequenceBuffer."""

from __future__ import annotations

from ravn.tui.keybindings.sequence import KeySequenceBuffer


class TestKeySequenceBuffer:
    def _buf(self) -> KeySequenceBuffer:
        buf = KeySequenceBuffer()
        buf.register(["ctrl+w", "v"], "split_vert")
        buf.register(["ctrl+w", "s"], "split_horiz")
        buf.register(["g", "g"], "scroll_top")
        return buf

    def test_single_key_no_match_not_consumed(self) -> None:
        buf = self._buf()
        action, consumed = buf.handle("j")
        assert action is None
        assert consumed is False

    def test_first_key_of_sequence_consumed_as_prefix(self) -> None:
        buf = self._buf()
        action, consumed = buf.handle("ctrl+w")
        assert action is None
        assert consumed is True

    def test_complete_two_key_sequence_matched(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        action, consumed = buf.handle("v")
        assert action == "split_vert"
        assert consumed is True

    def test_buffer_cleared_after_match(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        buf.handle("v")
        assert buf.pending == []

    def test_broken_sequence_flushes_buffer(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        action, consumed = buf.handle("x")  # "x" not in any ctrl+w sequence
        assert action is None
        assert consumed is False
        assert buf.pending == []

    def test_double_char_gg(self) -> None:
        buf = self._buf()
        action, consumed = buf.handle("g")
        assert action is None
        assert consumed is True
        action, consumed = buf.handle("g")
        assert action == "scroll_top"
        assert consumed is True

    def test_clear_discards_pending(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        assert buf.pending == ["ctrl+w"]
        buf.clear()
        assert buf.pending == []

    def test_single_key_sequences_ignored(self) -> None:
        buf = KeySequenceBuffer()
        buf.register(["j"], "select_next")
        # Single-key bindings are not registered in the buffer
        action, consumed = buf.handle("j")
        assert action is None
        assert consumed is False

    def test_multiple_sequences_same_prefix(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        action, consumed = buf.handle("s")
        assert action == "split_horiz"
        assert consumed is True

    def test_pending_property_returns_copy(self) -> None:
        buf = self._buf()
        buf.handle("ctrl+w")
        p = buf.pending
        p.append("extra")
        assert buf.pending == ["ctrl+w"]

    def test_max_buffer_depth_guard(self) -> None:
        """Buffer should clear itself after too many prefix keys."""
        buf = KeySequenceBuffer()
        # Register a very long sequence so prefix checks keep matching
        buf.register(["a", "b", "c", "d", "e"], "long_action")
        # First 4 keys are buffered as prefix
        for key in ["a", "b", "c", "d"]:
            _, consumed = buf.handle(key)
            assert consumed is True
        # At depth 4, buffer clears itself
        assert buf.pending == []
