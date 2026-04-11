"""KeySequenceBuffer — trie-based multi-key sequence matcher.

Replaces the ad-hoc ``_pending_ctrl_w`` boolean in ``app.py`` with a
general solution that handles arbitrary key sequences registered from
the keybinding map.

Usage::

    buf = KeySequenceBuffer()
    buf.register(["ctrl+w", "v"], "split_vert")
    buf.register(["g", "g"], "scroll_top")
    buf.register(["ctrl+h"], "focus_left")   # length-1: ignored here

    action, consumed = buf.handle("ctrl+w")
    # → (None, True)  — consumed, waiting for next key

    action, consumed = buf.handle("v")
    # → ("split_vert", True)  — complete match

    action, consumed = buf.handle("x")
    # → (None, False)  — not part of any sequence, pass through
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# How many keys to buffer before giving up (prevents indefinite waiting)
_MAX_BUFFER_DEPTH = 4


class KeySequenceBuffer:
    """Stateful matcher for multi-key sequences (length ≥ 2).

    Single-key bindings (length 1) are NOT registered here — they are
    handled by Textual's normal BINDINGS mechanism.  Only sequences of
    two or more keys need the buffer.
    """

    def __init__(self) -> None:
        # List of (key_sequence, action) — only length-2+ sequences
        self._sequences: list[tuple[list[str], str]] = []
        self._buffer: list[str] = []

    def register(self, keys: list[str], action: str) -> None:
        """Register a multi-key sequence.  Length-1 sequences are ignored."""
        if len(keys) >= 2:
            self._sequences.append((list(keys), action))

    def handle(self, key: str) -> tuple[str | None, bool]:
        """Process one incoming key event.

        Returns:
            (action, consumed) where:
            - ``action`` is the matched TUI action name or ``None``.
            - ``consumed`` is ``True`` if the key was absorbed by the
              buffer and should NOT be forwarded to Textual's normal
              binding dispatch.

        Callers should call ``event.stop()`` when ``consumed`` is ``True``.
        """
        candidate = self._buffer + [key]

        # Check for an exact match
        for seq, action in self._sequences:
            if seq == candidate:
                self._buffer = []
                logger.debug("sequence matched: %s → %s", candidate, action)
                return action, True

        # Check whether *candidate* is a prefix of any registered sequence
        is_prefix = any(seq[: len(candidate)] == candidate for seq, _ in self._sequences)
        if is_prefix:
            self._buffer = candidate
            # Guard against infinite buffering
            if len(self._buffer) >= _MAX_BUFFER_DEPTH:
                self._buffer = []
            return None, True  # consumed, partial match — wait for more

        # No match at all — flush buffer and let the event propagate
        if self._buffer:
            logger.debug("sequence broken by %r — flushing buffer %s", key, self._buffer)
        self._buffer = []
        return None, False

    def clear(self) -> None:
        """Discard any buffered partial key sequence (e.g. on focus loss)."""
        self._buffer = []

    @property
    def pending(self) -> list[str]:
        """Current buffered key sequence (read-only)."""
        return list(self._buffer)
