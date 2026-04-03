"""Shared configuration models for git providers.

These classes are used by both the niuu plugin (to create its own git
provider registry) and by Volundr (which embeds them in its Settings).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class GitHubInstance:
    """Configuration for a single GitHub instance."""

    name: str
    base_url: str
    token: str | None = None
    orgs: tuple[str, ...] = ()


@dataclass(frozen=True)
class GitLabInstance:
    """Configuration for a single GitLab instance."""

    name: str
    base_url: str
    token: str | None = None
    orgs: tuple[str, ...] = ()


class GitHubConfig(BaseModel):
    """GitHub provider configuration."""

    enabled: bool = Field(default=False)
    token: str | None = Field(default=None)
    base_url: str = Field(default="https://api.github.com")
    instances: list[dict[str, Any]] = Field(default_factory=list)

    def get_instances(self) -> list[GitHubInstance]:
        """Get all configured GitHub instances.

        Token resolution order per instance:
        1. Explicit ``token`` field in the instance dict
        2. Environment variable named by ``token_env`` (set by Helm from per-instance secrets)
        3. Top-level ``self.token`` (from ``GIT__GITHUB__TOKEN`` env var)
        """
        result: list[GitHubInstance] = []

        for item in self.instances:
            if not isinstance(item, dict):
                continue
            name = item.get("name", "")
            base_url = item.get("base_url", "")
            if not name or not base_url:
                continue
            token = item.get("token")
            if not token:
                token_env = item.get("token_env")
                if token_env:
                    token = os.environ.get(token_env)
            if not token:
                token = self.token
            orgs = tuple(item.get("orgs", []))
            result.append(GitHubInstance(name, base_url, token, orgs))

        if not result and (self.enabled or self.token):
            result.append(GitHubInstance("GitHub", self.base_url, self.token))

        return result


class GitLabConfig(BaseModel):
    """GitLab provider configuration."""

    enabled: bool = Field(default=False)
    token: str | None = Field(default=None)
    base_url: str = Field(default="https://gitlab.com")
    instances: list[dict[str, Any]] = Field(default_factory=list)

    def get_instances(self) -> list[GitLabInstance]:
        """Get all configured GitLab instances.

        Token resolution order per instance:
        1. Explicit ``token`` field in the instance dict
        2. Environment variable named by ``token_env`` (set by Helm from per-instance secrets)
        3. Top-level ``self.token`` (from ``GIT__GITLAB__TOKEN`` env var)
        """
        result: list[GitLabInstance] = []

        for item in self.instances:
            if not isinstance(item, dict):
                continue
            name = item.get("name", "")
            base_url = item.get("base_url", "")
            if not name or not base_url:
                continue
            token = item.get("token")
            if not token:
                token_env = item.get("token_env")
                if token_env:
                    token = os.environ.get(token_env)
            if not token:
                token = self.token
            orgs = tuple(item.get("orgs", []))
            result.append(GitLabInstance(name, base_url, token, orgs))

        if not result and (self.enabled or self.token):
            result.append(GitLabInstance("GitLab", self.base_url, self.token))

        return result


class GitConfig(BaseModel):
    """Git provider configuration (shared across niuu services)."""

    github: GitHubConfig = Field(default_factory=GitHubConfig)
    gitlab: GitLabConfig = Field(default_factory=GitLabConfig)
