"""Tests for domain services."""

from uuid import uuid4

import pytest

from tests.conftest import (
    InMemorySessionRepository,
    MockGitProvider,
    MockGitRegistry,
    MockPodManager,
)
from volundr.domain.models import GitProviderType, RepoInfo, SessionStatus
from volundr.domain.services import (
    RepoService,
    RepoValidationError,
    SessionNotFoundError,
    SessionService,
    SessionStateError,
)

# Type aliases for shorter signatures
Repo = InMemorySessionRepository
Pods = MockPodManager


class TestSessionServiceCreate:
    """Tests for SessionService.create_session."""

    async def test_create_session(self, repository: Repo, pod_manager: Pods):
        """Creating a session persists it to the repository."""
        service = SessionService(repository, pod_manager)

        session = await service.create_session(
            name="my-session",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )

        assert session.name == "my-session"
        assert session.model == "claude-3-opus"
        assert session.repo == "https://github.com/org/repo"
        assert session.branch == "main"
        assert session.status == SessionStatus.CREATED

        # Verify it's in the repository
        stored = await repository.get(session.id)
        assert stored is not None
        assert stored.id == session.id


class TestSessionServiceGet:
    """Tests for SessionService.get_session."""

    async def test_get_existing_session(self, repository: Repo, pod_manager: Pods):
        """Getting an existing session returns it."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        result = await service.get_session(created.id)

        assert result is not None
        assert result.id == created.id
        assert result.name == "test"

    async def test_get_nonexistent_session(self, repository: Repo, pod_manager: Pods):
        """Getting a nonexistent session returns None."""
        service = SessionService(repository, pod_manager)

        result = await service.get_session(uuid4())

        assert result is None


class TestSessionServiceList:
    """Tests for SessionService.list_sessions."""

    async def test_list_empty(self, repository: Repo, pod_manager: Pods):
        """Listing sessions when none exist returns empty list."""
        service = SessionService(repository, pod_manager)

        result = await service.list_sessions()

        assert result == []

    async def test_list_multiple_sessions(self, repository: Repo, pod_manager: Pods):
        """Listing sessions returns all sessions."""
        service = SessionService(repository, pod_manager)
        await service.create_session(
            name="session-1",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )
        await service.create_session(
            name="session-2",
            model="claude-3-sonnet",
            repo="https://github.com/org/repo",
            branch="dev",
        )

        result = await service.list_sessions()

        assert len(result) == 2
        names = {s.name for s in result}
        assert names == {"session-1", "session-2"}


class TestSessionServiceUpdate:
    """Tests for SessionService.update_session."""

    async def test_update_name(self, repository: Repo, pod_manager: Pods):
        """Updating session name works."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="old-name",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )

        updated = await service.update_session(created.id, name="new-name")

        assert updated.name == "new-name"
        assert updated.model == "claude-3-opus"  # Unchanged

    async def test_update_model(self, repository: Repo, pod_manager: Pods):
        """Updating session model works."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        updated = await service.update_session(created.id, model="claude-3-sonnet")

        assert updated.name == "test"  # Unchanged
        assert updated.model == "claude-3-sonnet"

    async def test_update_branch(self, repository: Repo, pod_manager: Pods):
        """Updating session branch works."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        updated = await service.update_session(created.id, branch="feature/new")

        assert updated.branch == "feature/new"
        assert updated.repo == "https://github.com/org/repo"  # Unchanged

    async def test_update_all(self, repository: Repo, pod_manager: Pods):
        """Updating name, model, and branch works."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="old", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        updated = await service.update_session(
            created.id, name="new", model="claude-3-sonnet", branch="dev"
        )

        assert updated.name == "new"
        assert updated.model == "claude-3-sonnet"
        assert updated.branch == "dev"

    async def test_update_nonexistent(self, repository: Repo, pod_manager: Pods):
        """Updating a nonexistent session raises SessionNotFoundError."""
        service = SessionService(repository, pod_manager)
        fake_id = uuid4()

        with pytest.raises(SessionNotFoundError) as exc_info:
            await service.update_session(fake_id, name="new")

        assert exc_info.value.session_id == fake_id


class TestSessionServiceDelete:
    """Tests for SessionService.delete_session."""

    async def test_delete_existing(self, repository: Repo, pod_manager: Pods):
        """Deleting an existing session returns True."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        result = await service.delete_session(created.id)

        assert result is True
        assert await repository.get(created.id) is None

    async def test_delete_nonexistent(self, repository: Repo, pod_manager: Pods):
        """Deleting a nonexistent session returns False."""
        service = SessionService(repository, pod_manager)

        result = await service.delete_session(uuid4())

        assert result is False

    async def test_delete_running_stops_pods(self, repository: Repo, pod_manager: Pods):
        """Deleting a running session stops its pods first."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        # Manually set to running to simulate started session
        running = created.with_status(SessionStatus.RUNNING)
        await repository.update(running)

        result = await service.delete_session(created.id)

        assert result is True
        assert len(pod_manager.stop_calls) == 1

    async def test_delete_running_succeeds_when_pod_stop_fails(
        self, repository: Repo, failing_pod_manager: Pods
    ):
        """Deleting a running session succeeds even if pod stop fails.

        This handles the case where Farm returns an error (e.g., 500) when
        trying to cancel a task that doesn't exist or has already been cleaned up.
        """
        service = SessionService(repository, failing_pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        # Manually set to running to simulate started session
        running = created.with_status(SessionStatus.RUNNING)
        await repository.update(running)

        # Delete should succeed even though pod_manager.stop() raises an exception
        result = await service.delete_session(created.id)

        assert result is True
        assert await repository.get(created.id) is None
        assert len(failing_pod_manager.stop_calls) == 1

    async def test_delete_running_attempts_pod_stop_before_deletion(
        self, repository: Repo, failing_pod_manager: Pods
    ):
        """Deleting a running session attempts pod stop even if it will fail."""
        service = SessionService(repository, failing_pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        running = created.with_status(SessionStatus.RUNNING)
        await repository.update(running)

        await service.delete_session(created.id)

        # Verify stop was called (even though it failed)
        assert len(failing_pod_manager.stop_calls) == 1
        assert failing_pod_manager.stop_calls[0].id == created.id


class TestSessionServiceStart:
    """Tests for SessionService.start_session."""

    async def test_start_session_success(self, repository: Repo, pod_manager: Pods):
        """Starting a session updates status and sets endpoints."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        result = await service.start_session(created.id)

        assert result.status == SessionStatus.PROVISIONING
        assert result.chat_endpoint == pod_manager.chat_endpoint
        assert result.code_endpoint == pod_manager.code_endpoint
        assert result.pod_name == pod_manager.pod_name
        assert len(pod_manager.start_calls) == 1

    async def test_start_stopped_session(self, repository: Repo, pod_manager: Pods):
        """Starting a stopped session works."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        stopped = created.with_status(SessionStatus.STOPPED)
        await repository.update(stopped)

        result = await service.start_session(created.id)

        assert result.status == SessionStatus.PROVISIONING

    async def test_start_failed_session(self, repository: Repo, pod_manager: Pods):
        """Starting a failed session works (retry)."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        failed = created.with_status(SessionStatus.FAILED)
        await repository.update(failed)

        result = await service.start_session(created.id)

        assert result.status == SessionStatus.PROVISIONING

    async def test_start_nonexistent(self, repository: Repo, pod_manager: Pods):
        """Starting a nonexistent session raises SessionNotFoundError."""
        service = SessionService(repository, pod_manager)

        with pytest.raises(SessionNotFoundError):
            await service.start_session(uuid4())

    async def test_start_running_session(self, repository: Repo, pod_manager: Pods):
        """Starting an already running session raises SessionStateError."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        running = created.with_status(SessionStatus.RUNNING)
        await repository.update(running)

        with pytest.raises(SessionStateError) as exc_info:
            await service.start_session(created.id)

        assert exc_info.value.operation == "start"
        assert exc_info.value.current_status == SessionStatus.RUNNING

    async def test_start_failure_marks_failed_with_error(
        self, repository: Repo, failing_pod_manager: Pods
    ):
        """If pod start fails, session is marked as FAILED with error message."""
        service = SessionService(repository, failing_pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        with pytest.raises(RuntimeError):
            await service.start_session(created.id)

        session = await repository.get(created.id)
        assert session is not None
        assert session.status == SessionStatus.FAILED
        assert session.error == "Pod start failed"



class TestSessionServiceStop:
    """Tests for SessionService.stop_session."""

    async def test_stop_session_success(self, repository: Repo, pod_manager: Pods):
        """Stopping a session updates status and clears endpoints."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        # Start it first
        started = await service.start_session(created.id)
        assert started.chat_endpoint is not None

        # Now stop it
        result = await service.stop_session(created.id)

        assert result.status == SessionStatus.STOPPED
        assert result.chat_endpoint is None
        assert result.code_endpoint is None
        assert len(pod_manager.stop_calls) == 1

    async def test_stop_nonexistent(self, repository: Repo, pod_manager: Pods):
        """Stopping a nonexistent session raises SessionNotFoundError."""
        service = SessionService(repository, pod_manager)

        with pytest.raises(SessionNotFoundError):
            await service.stop_session(uuid4())

    async def test_stop_created_session(self, repository: Repo, pod_manager: Pods):
        """Stopping a CREATED session raises SessionStateError."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )

        with pytest.raises(SessionStateError) as exc_info:
            await service.stop_session(created.id)

        assert exc_info.value.operation == "stop"
        assert exc_info.value.current_status == SessionStatus.CREATED

    async def test_stop_stopped_session(self, repository: Repo, pod_manager: Pods):
        """Stopping an already stopped session raises SessionStateError."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        stopped = created.with_status(SessionStatus.STOPPED)
        await repository.update(stopped)

        with pytest.raises(SessionStateError) as exc_info:
            await service.stop_session(created.id)

        assert exc_info.value.current_status == SessionStatus.STOPPED

    async def test_stop_failure_marks_failed_with_error(
        self, repository: Repo, failing_pod_manager: Pods
    ):
        """If pod stop fails, session is marked as FAILED with error message."""
        service = SessionService(repository, failing_pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        running = created.with_status(SessionStatus.RUNNING)
        await repository.update(running)

        with pytest.raises(RuntimeError):
            await service.stop_session(created.id)

        session = await repository.get(created.id)
        assert session is not None
        assert session.status == SessionStatus.FAILED
        assert session.error == "Pod stop failed"


class TestSessionServiceRecordActivity:
    """Tests for SessionService.record_activity."""

    async def test_record_activity_success(self, repository: Repo, pod_manager: Pods):
        """Recording activity updates metrics and last_active."""
        service = SessionService(repository, pod_manager)
        created = await service.create_session(
            name="test", model="claude-3-opus", repo="https://github.com/org/repo", branch="main"
        )
        original_last_active = created.last_active

        result = await service.record_activity(created.id, message_count=5, tokens=1000)

        assert result.message_count == 5
        assert result.tokens_used == 1000
        assert result.last_active >= original_last_active

    async def test_record_activity_nonexistent(self, repository: Repo, pod_manager: Pods):
        """Recording activity for nonexistent session raises SessionNotFoundError."""
        service = SessionService(repository, pod_manager)

        with pytest.raises(SessionNotFoundError):
            await service.record_activity(uuid4(), message_count=5, tokens=1000)


class TestSessionServiceGitValidation:
    """Tests for SessionService git repository validation."""

    async def test_create_session_with_git_validation_success(
        self, repository: Repo, pod_manager: Pods
    ):
        """Creating session with valid repo succeeds."""
        git_provider = MockGitProvider(validate_success=True)
        git_registry = MockGitRegistry([git_provider])
        service = SessionService(
            repository, pod_manager, git_registry=git_registry, validate_repos=True
        )

        session = await service.create_session(
            name="test",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )

        assert session is not None
        assert session.repo == "https://github.com/org/repo"
        assert len(git_provider.validate_calls) == 1

    async def test_create_session_with_git_validation_failure(
        self, repository: Repo, pod_manager: Pods
    ):
        """Creating session with invalid repo raises RepoValidationError."""
        git_provider = MockGitProvider(validate_success=False)
        git_registry = MockGitRegistry([git_provider])
        service = SessionService(
            repository, pod_manager, git_registry=git_registry, validate_repos=True
        )

        with pytest.raises(RepoValidationError) as exc_info:
            await service.create_session(
                name="test",
                model="claude-3-opus",
                repo="https://github.com/org/repo",
                branch="main",
            )

        assert "does not exist" in str(exc_info.value)

    async def test_create_session_with_unsupported_repo(self, repository: Repo, pod_manager: Pods):
        """Creating session with unsupported repo raises RepoValidationError."""
        git_provider = MockGitProvider(supported_hosts=["github.com"])
        git_registry = MockGitRegistry([git_provider])
        service = SessionService(
            repository, pod_manager, git_registry=git_registry, validate_repos=True
        )

        with pytest.raises(RepoValidationError) as exc_info:
            await service.create_session(
                name="test",
                model="claude-3-opus",
                repo="https://unknown.com/org/repo",
                branch="main",
            )

        assert "no git provider supports" in str(exc_info.value)

    async def test_create_session_validation_disabled(self, repository: Repo, pod_manager: Pods):
        """Creating session with validation disabled skips validation."""
        git_provider = MockGitProvider(validate_success=False)
        git_registry = MockGitRegistry([git_provider])
        service = SessionService(
            repository, pod_manager, git_registry=git_registry, validate_repos=False
        )

        session = await service.create_session(
            name="test",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )

        assert session is not None
        assert len(git_provider.validate_calls) == 0

    async def test_create_session_without_git_registry(self, repository: Repo, pod_manager: Pods):
        """Creating session without git registry skips validation."""
        service = SessionService(repository, pod_manager, git_registry=None)

        session = await service.create_session(
            name="test",
            model="claude-3-opus",
            repo="https://github.com/org/repo",
            branch="main",
        )

        assert session is not None



class TestRepoService:
    """Tests for RepoService."""

    def test_list_providers_empty(self):
        """list_providers returns empty list when no providers configured."""
        registry = MockGitRegistry()
        service = RepoService(registry)

        result = service.list_providers()

        assert result == []

    def test_list_providers_returns_all(self):
        """list_providers returns info for all registered providers."""
        gh = MockGitProvider(
            name="GitHub",
            provider_type=GitProviderType.GITHUB,
            orgs=("org1",),
        )
        gl = MockGitProvider(
            name="GitLab",
            provider_type=GitProviderType.GITLAB,
            orgs=("group1", "group2"),
        )
        registry = MockGitRegistry([gh, gl])
        service = RepoService(registry)

        result = service.list_providers()

        assert len(result) == 2
        assert result[0].name == "GitHub"
        assert result[0].type == GitProviderType.GITHUB
        assert result[0].orgs == ("org1",)
        assert result[1].name == "GitLab"
        assert result[1].type == GitProviderType.GITLAB
        assert result[1].orgs == ("group1", "group2")

    async def test_list_repos_empty(self):
        """list_repos returns empty dict when no providers have orgs."""
        gh = MockGitProvider(name="GitHub")
        registry = MockGitRegistry([gh])
        service = RepoService(registry)

        result = await service.list_repos()

        assert result == {}

    async def test_list_repos_returns_repos_grouped_by_provider(self):
        """list_repos returns repos grouped by provider name."""
        repos = [
            RepoInfo(
                provider=GitProviderType.GITHUB,
                org="myorg",
                name="repo1",
                clone_url="https://github.com/myorg/repo1.git",
                url="https://github.com/myorg/repo1",
            ),
        ]
        gh = MockGitProvider(
            name="GitHub",
            provider_type=GitProviderType.GITHUB,
            orgs=("myorg",),
            repos=repos,
        )
        registry = MockGitRegistry([gh])
        service = RepoService(registry)

        result = await service.list_repos()

        assert "GitHub" in result
        assert len(result["GitHub"]) == 1
        assert result["GitHub"][0].name == "repo1"


# ---------------------------------------------------------------------------
# In-memory stubs for TemplateProvider
# ---------------------------------------------------------------------------


class InMemoryTemplateProvider:
    """Simple in-memory TemplateProvider for testing."""

    def __init__(self, templates: list | None = None):
        from volundr.domain.models import WorkspaceTemplate

        self._templates: dict[str, WorkspaceTemplate] = {}
        for t in templates or []:
            self._templates[t.name] = t

    def get(self, name: str):
        return self._templates.get(name)

    def list(self, workload_type: str | None = None):
        if workload_type is None:
            return list(self._templates.values())
        return [t for t in self._templates.values() if t.workload_type == workload_type]


# ---------------------------------------------------------------------------
# Template wiring into session creation
# ---------------------------------------------------------------------------


class TestSessionServiceCreateWithTemplate:
    """Tests for SessionService.create_session template resolution."""

    async def test_create_session_with_template_resolves_repo_branch_model(
        self, repository: Repo, pod_manager: Pods
    ):
        """create_session with template_name resolves repo, branch, and model defaults."""
        from volundr.domain.models import WorkspaceTemplate

        template = WorkspaceTemplate(
            name="fullstack",
            model="claude-opus-4-20250514",
            repos=[
                {"url": "https://github.com/org/fullstack-app", "branch": "develop"},
            ],
        )
        template_provider = InMemoryTemplateProvider([template])
        service = SessionService(
            repository,
            pod_manager,
            template_provider=template_provider,
        )

        # Pass empty strings for repo/model to simulate "no explicit value"
        session = await service.create_session(
            name="my-session",
            model="",
            repo="",
            branch="main",
            template_name="fullstack",
        )

        assert session.repo == "https://github.com/org/fullstack-app"
        assert session.branch == "develop"
        assert session.model == "claude-opus-4-20250514"

    async def test_create_session_with_template_explicit_values_override(
        self, repository: Repo, pod_manager: Pods
    ):
        """create_session with template_name but explicit values override template defaults."""
        from volundr.domain.models import WorkspaceTemplate

        template = WorkspaceTemplate(
            name="fullstack",
            model="claude-opus-4-20250514",
            repos=[
                {"url": "https://github.com/org/fullstack-app", "branch": "develop"},
            ],
        )
        template_provider = InMemoryTemplateProvider([template])
        service = SessionService(
            repository,
            pod_manager,
            template_provider=template_provider,
        )

        # Caller provides explicit repo, branch, and model — they should win.
        session = await service.create_session(
            name="my-session",
            model="claude-sonnet-4-20250514",
            repo="https://github.com/other/repo",
            branch="main",
            template_name="fullstack",
        )

        assert session.repo == "https://github.com/other/repo"
        assert session.branch == "main"
        assert session.model == "claude-sonnet-4-20250514"
