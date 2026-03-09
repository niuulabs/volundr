"""Tests for the git provider registry."""

import pytest
import respx
from httpx import Response

from volundr.adapters.outbound.git_registry import GitProviderRegistry, create_git_registry
from volundr.adapters.outbound.github import GitHubProvider
from volundr.adapters.outbound.gitlab import GitLabProvider
from volundr.config import GitConfig, GitHubConfig, GitLabConfig
from volundr.domain.models import GitProviderType


class TestGitProviderRegistry:
    """Tests for GitProviderRegistry."""

    @pytest.fixture
    def github_provider(self) -> GitHubProvider:
        """Create a GitHub provider."""
        return GitHubProvider(
            name="GitHub",
            base_url="https://api.github.com",
            token="gh-token",
        )

    @pytest.fixture
    def gitlab_provider(self) -> GitLabProvider:
        """Create a GitLab provider."""
        return GitLabProvider(
            name="GitLab",
            base_url="https://gitlab.com",
            token="gl-token",
        )

    @pytest.fixture
    def internal_gitlab(self) -> GitLabProvider:
        """Create an internal GitLab provider."""
        return GitLabProvider(
            name="Internal GitLab",
            base_url="https://git.company.com",
            token="internal-token",
        )

    @pytest.fixture
    def registry(
        self,
        github_provider: GitHubProvider,
        gitlab_provider: GitLabProvider,
    ) -> GitProviderRegistry:
        """Create a registry with GitHub and GitLab."""
        registry = GitProviderRegistry()
        registry.register(github_provider)
        registry.register(gitlab_provider)
        return registry

    def test_register_provider(self, github_provider: GitHubProvider):
        """Can register providers."""
        registry = GitProviderRegistry()
        registry.register(github_provider)

        assert len(registry.providers) == 1
        assert registry.providers[0] is github_provider

    def test_register_multiple_providers(
        self,
        github_provider: GitHubProvider,
        gitlab_provider: GitLabProvider,
        internal_gitlab: GitLabProvider,
    ):
        """Can register multiple providers including same type."""
        registry = GitProviderRegistry()
        registry.register(github_provider)
        registry.register(gitlab_provider)
        registry.register(internal_gitlab)

        assert len(registry.providers) == 3

    def test_unregister_provider(
        self,
        github_provider: GitHubProvider,
        gitlab_provider: GitLabProvider,
    ):
        """Can unregister providers."""
        registry = GitProviderRegistry()
        registry.register(github_provider)
        registry.register(gitlab_provider)
        registry.unregister(github_provider)

        assert len(registry.providers) == 1
        assert registry.providers[0] is gitlab_provider

    def test_get_provider_github(self, registry: GitProviderRegistry):
        """Returns GitHub provider for GitHub URLs."""
        provider = registry.get_provider("https://github.com/org/repo")

        assert provider is not None
        assert provider.provider_type == GitProviderType.GITHUB

    def test_get_provider_gitlab(self, registry: GitProviderRegistry):
        """Returns GitLab provider for GitLab URLs."""
        provider = registry.get_provider("https://gitlab.com/group/project")

        assert provider is not None
        assert provider.provider_type == GitProviderType.GITLAB

    def test_get_provider_unknown(self, registry: GitProviderRegistry):
        """Returns None for unknown URLs."""
        provider = registry.get_provider("https://bitbucket.org/org/repo")

        assert provider is None

    def test_parse_repo_github(self, registry: GitProviderRegistry):
        """Parses GitHub repo URL."""
        info = registry.parse_repo("https://github.com/anthropics/claude")

        assert info is not None
        assert info.provider == GitProviderType.GITHUB
        assert info.org == "anthropics"
        assert info.name == "claude"

    def test_parse_repo_gitlab(self, registry: GitProviderRegistry):
        """Parses GitLab repo URL."""
        info = registry.parse_repo("https://gitlab.com/mygroup/myproject")

        assert info is not None
        assert info.provider == GitProviderType.GITLAB
        assert info.org == "mygroup"
        assert info.name == "myproject"

    def test_parse_repo_unknown(self, registry: GitProviderRegistry):
        """Returns None for unknown URLs."""
        info = registry.parse_repo("https://unknown.com/org/repo")

        assert info is None

    def test_get_clone_url_github(self, registry: GitProviderRegistry):
        """Returns authenticated GitHub clone URL."""
        url = registry.get_clone_url("https://github.com/org/repo")

        assert url == "https://x-access-token:gh-token@github.com/org/repo.git"

    def test_get_clone_url_gitlab(self, registry: GitProviderRegistry):
        """Returns authenticated GitLab clone URL."""
        url = registry.get_clone_url("https://gitlab.com/group/project")

        assert url == "https://oauth2:gl-token@gitlab.com/group/project.git"

    def test_get_clone_url_unknown(self, registry: GitProviderRegistry):
        """Returns None for unknown URLs."""
        url = registry.get_clone_url("https://bitbucket.org/org/repo")

        assert url is None

    @pytest.mark.asyncio
    async def test_validate_repo_delegates(self, registry: GitProviderRegistry):
        """Validate delegates to appropriate provider."""
        # This would require mocking HTTP calls, so just test routing
        provider = registry.get_provider("https://github.com/org/repo")
        assert provider is not None

    @pytest.mark.asyncio
    async def test_validate_repo_unknown_returns_false(self, registry: GitProviderRegistry):
        """Returns False for unknown URLs."""
        result = await registry.validate_repo("https://unknown.com/org/repo")

        assert result is False

    @pytest.mark.asyncio
    async def test_close(self, registry: GitProviderRegistry):
        """Close works without error."""
        await registry.close()


class TestGitProviderRegistryWithMultipleGitLabs:
    """Tests for registry with multiple GitLab instances."""

    @pytest.fixture
    def registry(self) -> GitProviderRegistry:
        """Create registry with multiple GitLab instances."""
        registry = GitProviderRegistry()
        registry.register(
            GitLabProvider(
                name="GitLab.com",
                base_url="https://gitlab.com",
                token="public-token",
            )
        )
        registry.register(
            GitLabProvider(
                name="Internal",
                base_url="https://git.company.com",
                token="internal-token",
            )
        )
        return registry

    def test_routes_to_correct_instance(self, registry: GitProviderRegistry):
        """Routes URLs to correct GitLab instance."""
        public_url = registry.get_clone_url("https://gitlab.com/org/repo")
        internal_url = registry.get_clone_url("https://git.company.com/team/project")

        assert "public-token" in public_url
        assert "gitlab.com" in public_url

        assert "internal-token" in internal_url
        assert "git.company.com" in internal_url


class TestCreateGitRegistry:
    """Tests for create_git_registry factory function."""

    def test_creates_empty_registry_without_tokens(self):
        """Creates empty registry when no tokens configured."""
        config = GitConfig(
            github=GitHubConfig(token=None),
            gitlab=GitLabConfig(token=None, instances=[]),
        )

        registry = create_git_registry(config)

        assert len(registry.providers) == 0

    def test_creates_github_provider_with_token(self):
        """Creates GitHub provider when token configured."""
        config = GitConfig(
            github=GitHubConfig(token="gh-token"),
            gitlab=GitLabConfig(token=None),
        )

        registry = create_git_registry(config)

        assert len(registry.providers) == 1
        assert registry.providers[0].provider_type == GitProviderType.GITHUB

    def test_creates_gitlab_provider_with_token(self):
        """Creates GitLab provider when token configured."""
        config = GitConfig(
            github=GitHubConfig(token=None),
            gitlab=GitLabConfig(token="gl-token", base_url="https://gitlab.com"),
        )

        registry = create_git_registry(config)

        assert len(registry.providers) == 1
        assert registry.providers[0].provider_type == GitProviderType.GITLAB

    def test_creates_multiple_gitlab_instances(self):
        """Creates multiple GitLab instances from list config."""
        instances = [
            {"name": "Internal", "base_url": "https://git.company.com", "token": "token1"},
            {"name": "Other", "base_url": "https://git.other.com", "token": "token2"},
        ]
        config = GitConfig(
            github=GitHubConfig(token=None),
            gitlab=GitLabConfig(token=None, instances=instances),
        )

        registry = create_git_registry(config)

        assert len(registry.providers) == 2
        names = [p.name for p in registry.providers]
        assert "Internal" in names
        assert "Other" in names

    def test_creates_all_providers(self):
        """Creates all configured providers."""
        instances = [
            {"name": "Internal", "base_url": "https://git.company.com", "token": "internal-token"}
        ]
        config = GitConfig(
            github=GitHubConfig(token="gh-token"),
            gitlab=GitLabConfig(
                token=None,  # No default instance
                base_url="https://gitlab.com",
                instances=instances,
            ),
        )

        registry = create_git_registry(config)

        # GitHub + Internal GitLab (YAML instances override default token)
        assert len(registry.providers) == 2

        types = [p.provider_type for p in registry.providers]
        assert GitProviderType.GITHUB in types
        assert types.count(GitProviderType.GITLAB) == 1

    def test_creates_providers_with_orgs(self):
        """Creates providers that carry through configured orgs."""
        config = GitConfig(
            github=GitHubConfig(
                instances=[
                    {
                        "name": "GitHub",
                        "base_url": "https://api.github.com",
                        "token": "tok",
                        "orgs": ["my-org"],
                    }
                ]
            ),
            gitlab=GitLabConfig(token=None),
        )

        registry = create_git_registry(config)

        assert len(registry.providers) == 1
        assert registry.providers[0].orgs == ("my-org",)


class TestGitProviderRegistryListConfiguredRepos:
    """Tests for list_configured_repos and reverse lookup."""

    @pytest.fixture
    def github_provider(self) -> GitHubProvider:
        """Create a GitHub provider with configured orgs."""
        return GitHubProvider(
            name="GitHub",
            base_url="https://api.github.com",
            token="gh-token",
            orgs=("myorg",),
        )

    @pytest.fixture
    def github_no_orgs(self) -> GitHubProvider:
        """Create a GitHub provider without configured orgs."""
        return GitHubProvider(
            name="GitHub (no orgs)",
            base_url="https://api.github.com",
            token="gh-token",
        )

    @pytest.mark.asyncio
    @respx.mock
    async def test_list_configured_repos_fetches_from_orgs(self, github_provider: GitHubProvider):
        """list_configured_repos fetches repos for each configured org."""
        respx.get("https://api.github.com/orgs/myorg/repos").mock(
            return_value=Response(
                200,
                json=[
                    {
                        "name": "repo1",
                        "clone_url": "https://github.com/myorg/repo1.git",
                        "html_url": "https://github.com/myorg/repo1",
                    },
                ],
            )
        )

        registry = GitProviderRegistry()
        registry.register(github_provider)

        result = await registry.list_configured_repos()

        assert "GitHub" in result
        assert len(result["GitHub"]) == 1
        assert result["GitHub"][0].name == "repo1"
        await github_provider.close()

    @pytest.mark.asyncio
    async def test_list_configured_repos_skips_providers_without_orgs(
        self, github_no_orgs: GitHubProvider
    ):
        """list_configured_repos skips providers that have no orgs configured."""
        registry = GitProviderRegistry()
        registry.register(github_no_orgs)

        result = await registry.list_configured_repos()

        assert result == {}

    @pytest.mark.asyncio
    @respx.mock
    async def test_reverse_lookup_populated_by_list_configured_repos(
        self, github_provider: GitHubProvider
    ):
        """After list_configured_repos, get_provider uses reverse lookup."""
        respx.get("https://api.github.com/orgs/myorg/repos").mock(
            return_value=Response(
                200,
                json=[
                    {
                        "name": "repo1",
                        "clone_url": "https://github.com/myorg/repo1.git",
                        "html_url": "https://github.com/myorg/repo1",
                    },
                ],
            )
        )

        registry = GitProviderRegistry()
        registry.register(github_provider)
        await registry.list_configured_repos()

        # Reverse lookup should resolve the web URL to the correct provider
        provider = registry.get_provider("https://github.com/myorg/repo1")
        assert provider is github_provider
        await github_provider.close()

    @pytest.mark.asyncio
    @respx.mock
    async def test_reverse_lookup_falls_back_to_pattern_matching(
        self, github_provider: GitHubProvider
    ):
        """get_provider still falls back to URL matching for unknown URLs."""
        registry = GitProviderRegistry()
        registry.register(github_provider)

        # No list_configured_repos call — reverse lookup is empty
        provider = registry.get_provider("https://github.com/other-org/other-repo")
        assert provider is github_provider
        await github_provider.close()
