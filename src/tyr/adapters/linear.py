"""Linear tracker adapter for Tyr.

Extends the shared LinearTrackerBase with saga/phase/raid CRUD operations.
Maps: Project=Saga, Milestone=Phase, Issue=Raid.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from niuu.adapters import linear_tracker as _lt
from niuu.adapters.linear import GraphQLError
from niuu.adapters.linear_tracker import LinearTrackerBase
from niuu.domain.models import LINEAR_API_URL
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State mapping
# ---------------------------------------------------------------------------

_RAID_TO_LINEAR: dict[RaidStatus, str] = {
    RaidStatus.PENDING: "Todo",
    RaidStatus.QUEUED: "Todo",
    RaidStatus.RUNNING: "In Progress",
    RaidStatus.REVIEW: "In Review",
    RaidStatus.MERGED: "Done",
    RaidStatus.FAILED: "Canceled",
}

_LINEAR_TO_RAID: dict[str, RaidStatus] = {
    "Backlog": RaidStatus.PENDING,
    "Todo": RaidStatus.PENDING,
    "In Progress": RaidStatus.RUNNING,
    "In Review": RaidStatus.REVIEW,
    "Done": RaidStatus.MERGED,
    "Canceled": RaidStatus.FAILED,
}

# ---------------------------------------------------------------------------
# GraphQL mutations (saga/phase/raid specific)
# ---------------------------------------------------------------------------

_LIST_ISSUE_RELATIONS_QUERY = """
query ListIssueRelations($projectId: ID!, $first: Int!) {
  issues(
    filter: { project: { id: { eq: $projectId } } }
    first: $first
  ) {
    nodes {
      identifier
      state { type }
      relations {
        nodes {
          type
          relatedIssue { identifier }
        }
      }
    }
  }
}
"""
_CREATE_PROJECT_QUERY = """
mutation CreateProject($name: String!, $description: String, $teamIds: [ID!]!) {
  projectCreate(input: { name: $name, description: $description, teamIds: $teamIds }) {
    project { id }
    success
  }
}
"""

_CREATE_MILESTONE_QUERY = """
mutation CreateMilestone($name: String!, $projectId: ID!, $sortOrder: Float!) {
  projectMilestoneCreate(input: { name: $name, projectId: $projectId, sortOrder: $sortOrder }) {
    projectMilestone { id }
    success
  }
}
"""

_CREATE_ISSUE_QUERY = """
mutation CreateIssue(
  $title: String!,
  $description: String,
  $projectId: ID!,
  $projectMilestoneId: ID,
  $teamId: ID!
) {
  issueCreate(input: {
    title: $title,
    description: $description,
    projectId: $projectId,
    projectMilestoneId: $projectMilestoneId,
    teamId: $teamId
  }) {
    issue { id identifier }
    success
  }
}
"""

_GET_ISSUE_QUERY = """
query GetIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    state { name }
    assignee { name }
    labels { nodes { name } }
    priority
    url
    projectMilestone { id }
    createdAt
    updatedAt
  }
}
"""

_GET_MILESTONE_QUERY = """
query GetMilestone($id: String!) {
  projectMilestone(id: $id) {
    id
    name
    description
    sortOrder
    progress
    project { id }
  }
}
"""

_UPDATE_ISSUE_STATE_QUERY = """
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    issue { id state { name } }
    success
  }
}
"""

_ADD_COMMENT_QUERY = """
mutation AddComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}
"""


class LinearTrackerAdapter(LinearTrackerBase, TrackerPort):
    """Linear tracker adapter: Project=Saga, Milestone=Phase, Issue=Raid.

    Inherits all browsing and issue management from LinearTrackerBase,
    adds saga/phase/raid CRUD operations.
    """

    def __init__(
        self,
        api_key: str,
        team_id: str | None = None,
        api_url: str = LINEAR_API_URL,
        cache_ttl: float = 30.0,
        max_retries: int = 3,
        **_extra: object,
    ) -> None:
        super().__init__(
            api_key=api_key,
            api_url=api_url,
            cache_ttl=cache_ttl,
            max_retries=max_retries,
        )
        self._team_id = team_id

    async def _get_team_id(self) -> str:
        """Return the configured team ID, or discover the first available team."""
        if self._team_id:
            return self._team_id
        data = await self._gql.query("{ teams { nodes { id } } }")
        nodes = data.get("teams", {}).get("nodes", [])
        if not nodes:
            raise GraphQLError("No Linear teams accessible with this API key")
        self._team_id = nodes[0]["id"]
        return self._team_id

    # -- CRUD: create --

    async def create_saga(self, saga: Saga) -> str:
        team_id = await self._get_team_id()
        data = await self._gql.query(
            _CREATE_PROJECT_QUERY,
            {
                "name": saga.name,
                "description": (
                    f"Saga: {saga.slug}\n"
                    f"Repos: {', '.join(saga.repos)}\n"
                    f"Branch: {saga.feature_branch}"
                ),
                "teamIds": [team_id],
            },
        )
        project = data.get("projectCreate", {}).get("project")
        if project is None:
            raise GraphQLError("Failed to create Linear project")
        self._gql.invalidate_cache("projects")
        return project["id"]

    async def create_phase(self, phase: Phase) -> str:
        data = await self._gql.query(
            _CREATE_MILESTONE_QUERY,
            {
                "name": phase.name,
                "projectId": phase.tracker_id,
                "sortOrder": float(phase.number),
            },
        )
        milestone = data.get("projectMilestoneCreate", {}).get("projectMilestone")
        if milestone is None:
            raise GraphQLError("Failed to create Linear milestone")
        self._gql.invalidate_cache("milestones")
        return milestone["id"]

    async def create_raid(self, raid: Raid) -> str:
        description = raid.description
        if raid.acceptance_criteria:
            criteria = "\n".join(f"- [ ] {c}" for c in raid.acceptance_criteria)
            description += f"\n\n## Acceptance Criteria\n{criteria}"
        if raid.declared_files:
            files = "\n".join(f"- `{f}`" for f in raid.declared_files)
            description += f"\n\n## Declared Files\n{files}"

        data = await self._gql.query(
            _CREATE_ISSUE_QUERY,
            {
                "title": raid.name,
                "description": description,
                "projectId": raid.tracker_id,
                "projectMilestoneId": str(raid.phase_id) if raid.phase_id else None,
                "teamId": await self._get_team_id(),
            },
        )
        issue = data.get("issueCreate", {}).get("issue")
        if issue is None:
            raise GraphQLError("Failed to create Linear issue")
        self._gql.invalidate_cache("issues")
        return issue["id"]

    # -- CRUD: update / close --

    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None:
        linear_state_name = _RAID_TO_LINEAR.get(state)
        if linear_state_name is None:
            raise ValueError(f"No Linear state mapping for {state}")

        state_id = await self._resolve_state_id(raid_id, linear_state_name)
        await self._gql.query(
            _UPDATE_ISSUE_STATE_QUERY,
            {"issueId": raid_id, "stateId": state_id},
        )
        self._gql.invalidate_cache("issues")

    async def close_raid(self, raid_id: str) -> None:
        state_id = await self._resolve_state_id(raid_id, "Done")
        await self._gql.query(
            _UPDATE_ISSUE_STATE_QUERY,
            {"issueId": raid_id, "stateId": state_id},
        )
        self._gql.invalidate_cache("issues")

    # -- Read: domain entities --

    async def get_saga(self, saga_id: str) -> Saga:
        data = await self._gql.query(_lt._GET_PROJECT_QUERY, {"id": saga_id})
        project = data.get("project")
        if project is None:
            raise GraphQLError(f"Project not found: {saga_id}")
        return self._project_to_saga(project)

    async def get_phase(self, tracker_id: str) -> Phase:
        data = await self._gql.query(_GET_MILESTONE_QUERY, {"id": tracker_id})
        milestone = data.get("projectMilestone")
        if milestone is None:
            raise GraphQLError(f"Milestone not found: {tracker_id}")
        return self._milestone_to_phase(milestone)

    async def get_raid(self, tracker_id: str) -> Raid:
        data = await self._gql.query(_GET_ISSUE_QUERY, {"id": tracker_id})
        issue = data.get("issue")
        if issue is None:
            raise GraphQLError(f"Issue not found: {tracker_id}")
        return self._issue_to_raid(issue)

    async def list_pending_raids(self, phase_id: str) -> list[Raid]:
        data = await self._gql.query(
            _lt._LIST_ISSUES_BY_MILESTONE_QUERY,
            {"projectId": "", "milestoneId": phase_id, "first": 100},
        )
        nodes = data.get("issues", {}).get("nodes", [])
        raids = [self._issue_to_raid(n) for n in nodes]
        return [r for r in raids if r.status in (RaidStatus.PENDING, RaidStatus.QUEUED)]

    async def get_blocked_identifiers(self, project_id: str) -> set[str]:
        """Fetch issue relations and return identifiers blocked by incomplete issues."""
        data = await self._gql.query(
            _LIST_ISSUE_RELATIONS_QUERY, {"projectId": project_id, "first": 250}
        )
        nodes = data.get("issues", {}).get("nodes", [])

        blocked: set[str] = set()
        for node in nodes:
            state_type = (node.get("state") or {}).get("type", "")
            if state_type == "completed":
                continue
            for rel in (node.get("relations") or {}).get("nodes", []):
                if rel.get("type") == "blocks":
                    target = (rel.get("relatedIssue") or {}).get("identifier", "")
                    if target:
                        blocked.add(target)
        return blocked

    # -- Conversion helpers (saga-specific) --

    @staticmethod
    def _project_to_saga(node: dict) -> Saga:
        now = datetime.now(UTC)
        return Saga(
            id=uuid4(),
            tracker_id=node["id"],
            tracker_type="linear",
            slug=node.get("name", "").lower().replace(" ", "-"),
            name=node.get("name", ""),
            repos=[],
            feature_branch="feat/test",
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

    @staticmethod
    def _milestone_to_phase(node: dict) -> Phase:
        return Phase(
            id=uuid4(),
            saga_id=UUID(int=0),
            tracker_id=node["id"],
            number=int(node.get("sortOrder", 0)),
            name=node.get("name", ""),
            status=PhaseStatus.PENDING,
            confidence=0.0,
        )

    @staticmethod
    def _issue_to_raid(node: dict) -> Raid:
        state_name = node.get("state", {}).get("name", "Todo")
        raid_status = _LINEAR_TO_RAID.get(state_name, RaidStatus.PENDING)
        now = datetime.now(UTC)
        return Raid(
            id=uuid4(),
            phase_id=UUID(int=0),
            tracker_id=node["id"],
            name=node.get("title", ""),
            description=node.get("description") or "",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=None,
            status=raid_status,
            confidence=0.0,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
