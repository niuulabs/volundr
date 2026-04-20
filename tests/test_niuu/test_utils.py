"""Tests for niuu.utils package (import_class and resolve_secret_kwargs)."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from niuu.utils import import_class, resolve_secret_kwargs


class TestImportClass:
    def test_imports_known_class(self) -> None:
        cls = import_class("niuu.utils.fibonacci.fibonacci")
        from niuu.utils.fibonacci import fibonacci

        assert cls is fibonacci

    def test_raises_on_invalid_module(self) -> None:
        with pytest.raises(ModuleNotFoundError):
            import_class("niuu.utils.nonexistent.SomeClass")


class TestResolveSecretKwargs:
    def test_empty_secret_kwargs_env_returns_kwargs_unchanged(self) -> None:
        kwargs = {"url": "http://example.com"}
        result = resolve_secret_kwargs(kwargs, {})
        assert result is kwargs

    def test_merges_env_var_into_kwargs(self) -> None:
        kwargs = {"url": "http://example.com"}
        with patch.dict(os.environ, {"MY_TOKEN": "secret"}):
            result = resolve_secret_kwargs(kwargs, {"token": "MY_TOKEN"})
        assert result == {"url": "http://example.com", "token": "secret"}

    def test_missing_env_var_does_not_add_key(self) -> None:
        kwargs = {"url": "http://example.com"}
        os.environ.pop("ABSENT_VAR", None)
        result = resolve_secret_kwargs(kwargs, {"key": "ABSENT_VAR"})
        assert result == {"url": "http://example.com"}

    def test_does_not_mutate_original_kwargs(self) -> None:
        kwargs = {"url": "http://example.com"}
        with patch.dict(os.environ, {"SECRET": "val"}):
            resolve_secret_kwargs(kwargs, {"secret": "SECRET"})
        assert "secret" not in kwargs
