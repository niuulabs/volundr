"""Tests for cli.auth.credentials — encrypted credential storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from cli.auth.credentials import CredentialStore, StoredTokens, _derive_key


@pytest.fixture
def cred_path(tmp_path: Path) -> Path:
    return tmp_path / "credentials"


@pytest.fixture
def store(cred_path: Path) -> CredentialStore:
    return CredentialStore(path=cred_path)


@pytest.fixture(autouse=True)
def _set_credential_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NIUU_CREDENTIAL_KEY", "test-secret-key-for-ci")


class TestDeriveKey:
    def test_key_is_32_bytes_urlsafe_base64(self) -> None:
        key = _derive_key()
        assert len(key) == 44  # 32 bytes base64-encoded

    def test_explicit_env_var_used(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("NIUU_CREDENTIAL_KEY", "my-key")
        key1 = _derive_key()
        monkeypatch.setenv("NIUU_CREDENTIAL_KEY", "other-key")
        key2 = _derive_key()
        assert key1 != key2


class TestCredentialStoreRoundTrip:
    def test_store_and_load(self, store: CredentialStore, cred_path: Path) -> None:
        tokens = StoredTokens(
            access_token="access123",
            refresh_token="refresh456",
            id_token="id789",
            token_type="Bearer",
            expires_at=1700000000.0,
            issuer="https://idp.example.com",
        )
        store.store(tokens)
        assert cred_path.exists()

        loaded = store.load()
        assert loaded is not None
        assert loaded.access_token == "access123"
        assert loaded.refresh_token == "refresh456"
        assert loaded.id_token == "id789"
        assert loaded.expires_at == 1700000000.0
        assert loaded.issuer == "https://idp.example.com"

    def test_file_permissions(self, store: CredentialStore, cred_path: Path) -> None:
        store.store(StoredTokens(access_token="x"))
        mode = oct(cred_path.stat().st_mode & 0o777)
        assert mode == "0o600"

    def test_load_returns_none_when_missing(self, store: CredentialStore) -> None:
        assert store.load() is None

    def test_load_returns_none_on_corrupt_data(
        self,
        store: CredentialStore,
        cred_path: Path,
    ) -> None:
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        cred_path.write_bytes(b"garbage")
        assert store.load() is None

    def test_clear_removes_file(self, store: CredentialStore, cred_path: Path) -> None:
        store.store(StoredTokens(access_token="x"))
        assert cred_path.exists()
        store.clear()
        assert not cred_path.exists()

    def test_clear_when_no_file(self, store: CredentialStore) -> None:
        store.clear()  # should not raise

    def test_overwrite_existing(self, store: CredentialStore) -> None:
        store.store(StoredTokens(access_token="first"))
        store.store(StoredTokens(access_token="second"))
        loaded = store.load()
        assert loaded is not None
        assert loaded.access_token == "second"
