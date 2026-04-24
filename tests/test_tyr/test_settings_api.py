"""Tests for Tyr settings compatibility endpoints."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.api.settings import create_settings_router
from tyr.config import AuthConfig, NotificationConfig, Settings, WatcherConfig


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(create_settings_router())
    app.state.settings = Settings(
        auth=AuthConfig(allow_anonymous_dev=True),
        notification=NotificationConfig(enabled=True, confidence_threshold=0.4),
        watcher=WatcherConfig(batch_size=12),
    )
    return TestClient(app)


class TestSettingsAPI:
    def test_get_flock_settings_returns_defaults(self) -> None:
        client = _make_client()

        response = client.get("/api/v1/tyr/settings/flock")

        assert response.status_code == 200
        body = response.json()
        assert body["flock_name"] == "default"
        assert body["default_base_branch"] == "main"
        assert body["default_tracker_type"] == "linear"
        assert body["auto_create_milestones"] is True

    def test_patch_dispatch_defaults_updates_nested_retry_policy(self) -> None:
        client = _make_client()

        response = client.patch(
            "/api/v1/tyr/settings/dispatch",
            json={
                "confidence_threshold": 75,
                "auto_continue": True,
                "retry_policy": {
                    "max_retries": 5,
                    "retry_delay_seconds": 60,
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["confidence_threshold"] == 75
        assert body["auto_continue"] is True
        assert body["retry_policy"]["max_retries"] == 5
        assert body["retry_policy"]["retry_delay_seconds"] == 60

    def test_patch_notification_settings_is_persisted_in_process(self) -> None:
        client = _make_client()

        patch_response = client.patch(
            "/api/v1/tyr/settings/notifications",
            json={
                "channel": "webhook",
                "on_dispatcher_error": False,
                "webhook_url": "https://hooks.example.test/tyr",
            },
        )
        get_response = client.get("/api/v1/tyr/settings/notifications")

        assert patch_response.status_code == 200
        assert get_response.status_code == 200
        body = get_response.json()
        assert body["channel"] == "webhook"
        assert body["on_dispatcher_error"] is False
        assert body["webhook_url"] == "https://hooks.example.test/tyr"
