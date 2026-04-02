"""Tests for cli package __init__."""

from __future__ import annotations

import cli


class TestVersion:
    def test_version_is_string(self):
        assert isinstance(cli.__version__, str)

    def test_version_not_empty(self):
        assert cli.__version__
