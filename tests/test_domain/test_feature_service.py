"""Tests for FeatureService."""

from __future__ import annotations

import pytest

from volundr.config import FeatureModuleConfig
from volundr.domain.services.feature import (
    FeatureModule,
    FeatureService,
    UserFeaturePreference,
)

# ── Fake asyncpg pool for testing ──────────────────────────────────


class FakeConnection:
    """Minimal async connection stub for feature service tests."""

    def __init__(self, pool: FakePool):
        self._pool = pool

    async def execute(self, query: str, *args):
        if "DELETE FROM user_feature_preferences" in query:
            user_id = args[0]
            self._pool._user_prefs = {
                k: v for k, v in self._pool._user_prefs.items() if k[0] != user_id
            }
        elif "INSERT INTO user_feature_preferences" in query:
            user_id, feature_key, visible, sort_order = args
            self._pool._user_prefs[(user_id, feature_key)] = {
                "feature_key": feature_key,
                "visible": visible,
                "sort_order": sort_order,
            }

    def transaction(self):
        return FakeTransaction()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class FakePool:
    """Minimal asyncpg pool stub that stores feature toggles and user prefs in memory."""

    def __init__(self):
        self._toggles: dict[str, bool] = {}
        self._user_prefs: dict[tuple[str, str], dict] = {}

    async def fetch(self, query: str, *args):
        if "FROM feature_toggles" in query:
            return [{"feature_key": k, "enabled": v} for k, v in self._toggles.items()]
        if "FROM user_feature_preferences" in query:
            user_id = args[0]
            rows = [v for (uid, _), v in self._user_prefs.items() if uid == user_id]
            rows.sort(key=lambda r: r["sort_order"])
            return rows
        return []

    async def fetchrow(self, query: str, *args):
        rows = await self.fetch(query, *args)
        return rows[0] if rows else None

    async def execute(self, query: str, *args):
        if "INSERT INTO feature_toggles" in query or "ON CONFLICT" in query:
            key, enabled = args[0], args[1]
            self._toggles[key] = enabled
        return None

    def acquire(self):
        return FakeConnection(self)


# ── Fixtures ────────────────────────────────────────────────────────


def _default_configs() -> list[FeatureModuleConfig]:
    return [
        FeatureModuleConfig(
            key="users",
            label="Users",
            icon="Users",
            scope="admin",
            default_enabled=True,
            admin_only=True,
            order=10,
        ),
        FeatureModuleConfig(
            key="storage",
            label="Storage",
            icon="HardDrive",
            scope="admin",
            default_enabled=True,
            admin_only=True,
            order=30,
        ),
        FeatureModuleConfig(
            key="credentials",
            label="Credentials",
            icon="KeyRound",
            scope="user",
            default_enabled=True,
            order=10,
        ),
        FeatureModuleConfig(
            key="appearance",
            label="Appearance",
            icon="Palette",
            scope="user",
            default_enabled=True,
            order=40,
        ),
    ]


@pytest.fixture
def pool():
    return FakePool()


@pytest.fixture
def service(pool):
    return FeatureService(pool, _default_configs())


# ── Catalog tests ───────────────────────────────────────────────────


class TestFeatureCatalog:
    async def test_get_all_features(self, service):
        modules = await service.get_catalog()
        assert len(modules) == 4
        assert all(isinstance(m, FeatureModule) for m in modules)

    async def test_filter_by_scope_admin(self, service):
        modules = await service.get_catalog(scope="admin")
        assert len(modules) == 2
        assert all(m.scope == "admin" for m in modules)

    async def test_filter_by_scope_user(self, service):
        modules = await service.get_catalog(scope="user")
        assert len(modules) == 2
        assert all(m.scope == "user" for m in modules)

    async def test_catalog_respects_sort_order(self, service):
        modules = await service.get_catalog()
        orders = [m.order for m in modules]
        assert orders == sorted(orders)

    async def test_disabled_features_excluded_by_default(self, service, pool):
        pool._toggles["users"] = False
        modules = await service.get_catalog()
        keys = [m.key for m in modules]
        assert "users" not in keys

    async def test_include_disabled_features(self, service, pool):
        pool._toggles["users"] = False
        modules = await service.get_catalog(include_disabled=True)
        keys = [m.key for m in modules]
        assert "users" in keys

    async def test_enabled_override_from_db(self, service, pool):
        pool._toggles["users"] = True
        modules = await service.get_catalog(include_disabled=True)
        user_mod = next(m for m in modules if m.key == "users")
        assert user_mod.enabled is True


# ── Toggle tests ────────────────────────────────────────────────────


class TestFeatureToggle:
    async def test_set_feature_enabled(self, service, pool):
        await service.set_feature_enabled("users", False)
        assert pool._toggles["users"] is False

    async def test_set_feature_enabled_true(self, service, pool):
        await service.set_feature_enabled("users", False)
        await service.set_feature_enabled("users", True)
        assert pool._toggles["users"] is True

    async def test_toggle_unknown_key_raises(self, service):
        with pytest.raises(ValueError, match="Unknown feature key"):
            await service.set_feature_enabled("nonexistent", True)

    async def test_toggle_persists_to_catalog(self, service, pool):
        await service.set_feature_enabled("storage", False)
        modules = await service.get_catalog(scope="admin")
        keys = [m.key for m in modules]
        assert "storage" not in keys


# ── User preferences tests ─────────────────────────────────────────


class TestUserPreferences:
    async def test_empty_preferences_by_default(self, service):
        prefs = await service.get_user_preferences("user-1")
        assert prefs == []

    async def test_update_user_preferences(self, service):
        prefs = [
            UserFeaturePreference(feature_key="credentials", visible=True, sort_order=0),
            UserFeaturePreference(feature_key="appearance", visible=False, sort_order=10),
        ]
        result = await service.update_user_preferences("user-1", prefs)
        assert len(result) == 2
        assert result[0].feature_key == "credentials"
        assert result[1].feature_key == "appearance"
        assert result[1].visible is False

    async def test_update_replaces_existing(self, service):
        prefs1 = [
            UserFeaturePreference(feature_key="credentials", visible=True, sort_order=0),
        ]
        await service.update_user_preferences("user-1", prefs1)

        prefs2 = [
            UserFeaturePreference(feature_key="appearance", visible=True, sort_order=0),
        ]
        result = await service.update_user_preferences("user-1", prefs2)
        assert len(result) == 1
        assert result[0].feature_key == "appearance"

    async def test_preferences_per_user_isolation(self, service):
        await service.update_user_preferences(
            "user-1",
            [
                UserFeaturePreference(feature_key="credentials", visible=False, sort_order=0),
            ],
        )
        await service.update_user_preferences(
            "user-2",
            [
                UserFeaturePreference(feature_key="appearance", visible=False, sort_order=0),
            ],
        )

        prefs1 = await service.get_user_preferences("user-1")
        prefs2 = await service.get_user_preferences("user-2")

        assert len(prefs1) == 1
        assert prefs1[0].feature_key == "credentials"
        assert len(prefs2) == 1
        assert prefs2[0].feature_key == "appearance"
