"""Tests for cli.auth.oidc — OIDC/PKCE authentication client."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import httpx
import pytest
import respx

from cli.auth.credentials import CredentialStore, StoredTokens
from cli.auth.oidc import (
    OIDCClient,
    decode_id_token,
    generate_pkce_pair,
)


@pytest.fixture(autouse=True)
def _set_credential_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NIUU_CREDENTIAL_KEY", "test-secret-key-for-ci")


class TestPKCE:
    def test_verifier_length(self) -> None:
        verifier, _ = generate_pkce_pair()
        assert len(verifier) > 40

    def test_challenge_is_s256(self) -> None:
        verifier, challenge = generate_pkce_pair()
        expected_digest = hashlib.sha256(verifier.encode("ascii")).digest()
        expected = base64.urlsafe_b64encode(expected_digest).rstrip(b"=").decode("ascii")
        assert challenge == expected

    def test_unique_pairs(self) -> None:
        pair1 = generate_pkce_pair()
        pair2 = generate_pkce_pair()
        assert pair1[0] != pair2[0]


class TestDecodeIdToken:
    def test_decodes_jwt_without_verification(self) -> None:
        import jwt as pyjwt

        payload = {"sub": "user-1", "name": "Test User", "email": "test@example.com"}
        token = pyjwt.encode(payload, "a-test-secret-long-enough-for-hs256", algorithm="HS256")
        claims = decode_id_token(token)
        assert claims["sub"] == "user-1"
        assert claims["name"] == "Test User"


class TestOIDCClientDiscover:
    async def test_fetches_discovery_document(self) -> None:
        issuer = "https://idp.example.com"
        discovery = {
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "issuer": issuer,
        }
        with respx.mock:
            respx.get(f"{issuer}/.well-known/openid-configuration").mock(
                return_value=httpx.Response(200, json=discovery)
            )
            client = OIDCClient(issuer=issuer, client_id="test")
            result = await client.discover()
        assert result["authorization_endpoint"] == f"{issuer}/authorize"

    async def test_caches_discovery(self) -> None:
        issuer = "https://idp.example.com"
        discovery = {"authorization_endpoint": "x", "token_endpoint": "y"}
        with respx.mock:
            route = respx.get(f"{issuer}/.well-known/openid-configuration").mock(
                return_value=httpx.Response(200, json=discovery)
            )
            client = OIDCClient(issuer=issuer, client_id="test")
            await client.discover()
            await client.discover()
        assert route.call_count == 1


class TestOIDCClientRefresh:
    async def test_refresh_exchanges_token(self, tmp_path: Path) -> None:
        issuer = "https://idp.example.com"
        store = CredentialStore(path=tmp_path / "creds")
        store.store(
            StoredTokens(
                access_token="old-access",
                refresh_token="refresh-tok",
                issuer=issuer,
            )
        )

        client = OIDCClient(
            issuer=issuer,
            client_id="cli",
            credential_store=store,
        )
        client._discovery = {
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
        }

        with respx.mock:
            respx.post(f"{issuer}/token").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "access_token": "new-access",
                        "refresh_token": "new-refresh",
                        "token_type": "Bearer",
                        "expires_in": 3600,
                    },
                )
            )
            new_token = await client.refresh()

        assert new_token == "new-access"
        loaded = store.load()
        assert loaded is not None
        assert loaded.access_token == "new-access"
        assert loaded.refresh_token == "new-refresh"

    async def test_refresh_returns_none_without_tokens(self, tmp_path: Path) -> None:
        store = CredentialStore(path=tmp_path / "creds")
        client = OIDCClient(
            issuer="https://idp.example.com",
            client_id="cli",
            credential_store=store,
        )
        result = await client.refresh()
        assert result is None

    async def test_refresh_returns_none_on_error(self, tmp_path: Path) -> None:
        issuer = "https://idp.example.com"
        store = CredentialStore(path=tmp_path / "creds")
        store.store(
            StoredTokens(
                access_token="old",
                refresh_token="ref",
                issuer=issuer,
            )
        )
        client = OIDCClient(issuer=issuer, client_id="cli", credential_store=store)
        client._discovery = {
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
        }
        with respx.mock:
            respx.post(f"{issuer}/token").mock(
                return_value=httpx.Response(400, json={"error": "invalid_grant"})
            )
            result = await client.refresh()
        assert result is None


class TestOIDCClientWhoami:
    def test_whoami_returns_claims(self, tmp_path: Path) -> None:
        import jwt as pyjwt

        id_token = pyjwt.encode(
            {"sub": "u1", "name": "Alice", "email": "alice@example.com"},
            "a-test-secret-long-enough-for-hs256",
            algorithm="HS256",
        )
        store = CredentialStore(path=tmp_path / "creds")
        store.store(StoredTokens(access_token="x", id_token=id_token))

        client = OIDCClient(issuer="", client_id="", credential_store=store)
        claims = client.whoami()
        assert claims is not None
        assert claims["name"] == "Alice"

    def test_whoami_returns_none_when_not_logged_in(self, tmp_path: Path) -> None:
        store = CredentialStore(path=tmp_path / "creds")
        client = OIDCClient(issuer="", client_id="", credential_store=store)
        assert client.whoami() is None


class TestOIDCClientLogout:
    def test_logout_clears_store(self, tmp_path: Path) -> None:
        store = CredentialStore(path=tmp_path / "creds")
        store.store(StoredTokens(access_token="x"))
        client = OIDCClient(issuer="", client_id="", credential_store=store)
        client.logout()
        assert store.load() is None


class TestOIDCClientLoadAccessToken:
    def test_load_access_token(self, tmp_path: Path) -> None:
        store = CredentialStore(path=tmp_path / "creds")
        store.store(StoredTokens(access_token="my-token"))
        client = OIDCClient(issuer="", client_id="", credential_store=store)
        assert client.load_access_token() == "my-token"

    def test_load_access_token_none(self, tmp_path: Path) -> None:
        store = CredentialStore(path=tmp_path / "creds")
        client = OIDCClient(issuer="", client_id="", credential_store=store)
        assert client.load_access_token() is None
