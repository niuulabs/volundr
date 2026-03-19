"""Tests for secret manifest sourcing logic (devrunner._source_secrets equivalent)."""

import json
import os
from pathlib import Path

import pytest


def _source_secrets(manifest_path: Path, secret_dir: Path) -> None:
    """Standalone version of devrunner._source_secrets for testing."""
    if not manifest_path.exists() or not secret_dir.is_dir():
        return

    manifest = json.loads(manifest_path.read_text())
    for env_var, spec in manifest.get("env", {}).items():
        fpath = secret_dir / spec["file"]
        if not fpath.exists():
            continue
        data = json.loads(fpath.read_text())
        os.environ[env_var] = data.get(spec.get("key", ""), "")

    for target, spec in manifest.get("files", {}).items():
        src = secret_dir / spec["file"]
        if src.exists():
            Path(target).parent.mkdir(parents=True, exist_ok=True)
            if not Path(target).exists():
                Path(target).symlink_to(src)


class TestSecretManifestSourcing:
    def test_env_vars_from_manifest(self, tmp_path):
        secret_dir = tmp_path / "user"
        secret_dir.mkdir()
        (secret_dir / "openai-cred").write_text(json.dumps({"api_key": "sk-test-123"}))

        manifest = {
            "env": {
                "OPENAI_API_KEY": {"file": "openai-cred", "key": "api_key"},
            },
            "files": {},
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        _source_secrets(manifest_path, secret_dir)

        assert os.environ.get("OPENAI_API_KEY") == "sk-test-123"
        # Cleanup
        os.environ.pop("OPENAI_API_KEY", None)

    def test_file_symlinks_from_manifest(self, tmp_path):
        secret_dir = tmp_path / "user"
        secret_dir.mkdir()
        cred_file = secret_dir / "claude-oauth"
        cred_file.write_text(json.dumps({"access_token": "token-xyz"}))

        target_path = str(tmp_path / "home" / ".claude" / "credentials.json")
        manifest = {
            "env": {},
            "files": {
                target_path: {"file": "claude-oauth"},
            },
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        _source_secrets(manifest_path, secret_dir)

        assert Path(target_path).is_symlink()
        assert Path(target_path).resolve() == cred_file.resolve()

    def test_missing_credential_file_skipped(self, tmp_path):
        secret_dir = tmp_path / "user"
        secret_dir.mkdir()

        manifest = {
            "env": {
                "MISSING_KEY": {"file": "nonexistent", "key": "api_key"},
            },
            "files": {},
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        _source_secrets(manifest_path, secret_dir)
        assert os.environ.get("MISSING_KEY") is None

    def test_noop_when_no_manifest(self, tmp_path):
        """No-op when manifest doesn't exist."""
        _source_secrets(tmp_path / "missing.json", tmp_path / "user")

    def test_multiple_env_vars(self, tmp_path):
        secret_dir = tmp_path / "user"
        secret_dir.mkdir()
        (secret_dir / "github-cred").write_text(json.dumps({"token": "gh-tok"}))
        (secret_dir / "openai-cred").write_text(json.dumps({"api_key": "sk-123"}))

        manifest = {
            "env": {
                "GITHUB_TOKEN": {"file": "github-cred", "key": "token"},
                "OPENAI_API_KEY": {"file": "openai-cred", "key": "api_key"},
            },
            "files": {},
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))

        _source_secrets(manifest_path, secret_dir)

        assert os.environ.get("GITHUB_TOKEN") == "gh-tok"
        assert os.environ.get("OPENAI_API_KEY") == "sk-123"
        os.environ.pop("GITHUB_TOKEN", None)
        os.environ.pop("OPENAI_API_KEY", None)
