"""Linear tracker adapter.

Implements TrackerPort using the Linear GraphQL API.
Maps: Project=Saga, Milestone=Phase, Issue=Raid.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from niuu.adapters.linear import GraphQLError, LinearGraphQLClient
from niuu.domain.models import LINEAR_API_URL
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
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
# GraphQL queries
# ---------------------------------------------------------------------------

_PROJECT_FIELDS = """
      id
      name
      description
      state
      url
      startDate
      targetDate
      progress
      slugId
      projectMilestones { nodes { id progress } }
      issues { nodes { id } }
"""

_LIST_PROJECTS_QUERY = """
query ListProjects($first: Int!) {
  projects(first: $first) {
    nodes {
""" + _PROJECT_FIELDS + """
    }
  }
}
"""

_GET_PROJECT_QUERY = """
query GetProject($id: String!) {
  project(id: $id) {
""" + _PROJECT_FIELDS + """
  }
}
"""

_LIST_MILESTONES_QUERY = """
query ListMilestones($projectId: String!) {
  project(id: $projectId) {
    projectMilestones {
      nodes {
        id
        name
        description
        sortOrder
        progress
        targetDate
      }
    }
  }
}
"""

_GET_PROJECT_FULL_QUERY = """
query GetProjectFull($id: String!, $issueFirst: Int!) {
  project(id: $id) {
      id
      name
      description
      state
      url
      startDate
      targetDate
      progress
      projectMilestones {
        nodes {
          id
          name
          description
          sortOrder
          progress
          targetDate
        }
      }
      issueCount: issues { nodes { id } }
      issuesFull: issues(first: $issueFirst) {
        nodes {
          id
          identifier
          title
          description
          state { name type }
          assignee { name }
          labels { nodes { name } }
          priority
          priorityLabel
          estimate
          url
          projectMilestone { id }
        }
      }
  }
}
"""

_ISSUE_FIELDS = """
      id
      identifier
      title
      description
      state { name type }
      assignee { name }
      labels { nodes { name } }
      priority
      priorityLabel
      estimate
      url
      projectMilestone { id }
"""

_LIST_ISSUES_QUERY = """
query ListIssues($projectId: ID!, $first: Int!) {
  issues(
    filter: { project: { id: { eq: $projectId } } }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {
""" + _ISSUE_FIELDS + """
    }
  }
}
"""

_LIST_ISSUES_BY_MILESTONE_QUERY = """
query ListIssuesByMilestone($projectId: ID!, $milestoneId: ID!, $first: Int!) {
  issues(
    filter: {
      project: { id: { eq: $projectId } }
      projectMilestone: { id: { eq: $milestoneId } }
    }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {
""" + _ISSUE_FIELDS + """
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

_ISSUE_TEAM_QUERY = """
query IssueTeam($id: String!) {
  issue(id: $id) {
    team { id }
  }
}
"""

_TEAM_STATES_QUERY = """
query TeamStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes { id name }
    }
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


class LinearTrackerAdapter(TrackerPort):
    """Linear tracker adapter: Project=Saga, Milestone=Phase, Issue=Raid."""

    def __init__(
        self,
        api_key: str,
        team_id: str | None = None,
        api_url: str = LINEAR_API_URL,
        cache_ttl: float = 30.0,
        max_retries: int = 3,
        **_extra: object,
    ) -> None:
        self._team_id = team_id
        self._gql = LinearGraphQLClient(
            api_key=api_key,
            api_url=api_url,
            cache_ttl=cache_ttl,
            max_retries=max_retries,
        )

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
        data = await self._gql.query(_GET_PROJECT_QUERY, {"id": saga_id})
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
            _LIST_ISSUES_BY_MILESTONE_QUERY,
            {"projectId": "", "milestoneId": phase_id, "first": 100},
        )
        nodes = data.get("issues", {}).get("nodes", [])
        raids = [self._issue_to_raid(n) for n in nodes]
        return [r for r in raids if r.status in (RaidStatus.PENDING, RaidStatus.QUEUED)]

    # -- Browsing --

    async def list_projects(self) -> list[TrackerProject]:
        cache_key = "projects:all"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        data = await self._gql.query(_LIST_PROJECTS_QUERY, {"first": 50})
        nodes = data.get("projects", {}).get("nodes", [])
        projects = [self._node_to_tracker_project(n) for n in nodes]
        self._gql.set_cached(cache_key, projects)
        return projects

    async def get_project(self, project_id: str) -> TrackerProject:
        data = await self._gql.query(_GET_PROJECT_QUERY, {"id": project_id})
        project = data.get("project")
        if project is None:
            raise GraphQLError(f"Project not found: {project_id}")
        return self._node_to_tracker_project(project)

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        cache_key = f"milestones:{project_id}"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        data = await self._gql.query(_LIST_MILESTONES_QUERY, {"projectId": project_id})
        nodes = data.get("project", {}).get("projectMilestones", {}).get("nodes", [])
        milestones = [self._node_to_tracker_milestone(n, project_id) for n in nodes]
        milestones.sort(key=lambda m: m.sort_order)
        self._gql.set_cached(cache_key, milestones)
        return milestones

    async def list_issues(
        self,
        project_id: str,
        milestone_id: str | None = None,
    ) -> list[TrackerIssue]:
        cache_key = f"issues:{project_id}:{milestone_id}"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        if milestone_id:
            data = await self._gql.query(
                _LIST_ISSUES_BY_MILESTONE_QUERY,
                {"projectId": project_id, "milestoneId": milestone_id, "first": 100},
            )
        else:
            data = await self._gql.query(
                _LIST_ISSUES_QUERY,
                {"projectId": project_id, "first": 100},
            )

        nodes = data.get("issues", {}).get("nodes", [])
        issues = [self._node_to_tracker_issue(n) for n in nodes]
        self._gql.set_cached(cache_key, issues)
        return issues

    async def get_project_full(
        self, project_id: str
    ) -> tuple[TrackerProject, list[TrackerMilestone], list[TrackerIssue]]:
        """Fetch project, milestones, and issues in a single GraphQL call."""
        data = await self._gql.query(
            _GET_PROJECT_FULL_QUERY, {"id": project_id, "issueFirst": 250}
        )
        project_node = data.get("project")
        if project_node is None:
            raise GraphQLError(f"Project not found: {project_id}")

        # The full query uses aliased fields to avoid conflicts
        # Restore standard keys for _node_to_tracker_project
        project_for_counts = {
            **project_node,
            "issues": project_node.get("issueCount", {}),
        }
        project = self._node_to_tracker_project(project_for_counts)

        ms_nodes = project_node.get("projectMilestones", {}).get("nodes", [])
        milestones = [self._node_to_tracker_milestone(n, project_id) for n in ms_nodes]
        milestones.sort(key=lambda m: m.sort_order)

        issue_nodes = project_node.get("issuesFull", {}).get("nodes", [])
        issues = [self._node_to_tracker_issue(n) for n in issue_nodes]

        return project, milestones, issues

    # -- Internal helpers --

    async def _resolve_state_id(self, issue_id: str, state_name: str) -> str:
        """Resolve a Linear workflow state ID by name for an issue's team."""
        team_data = await self._gql.query(_ISSUE_TEAM_QUERY, {"id": issue_id})
        issue_node = team_data.get("issue")
        if issue_node is None:
            raise GraphQLError(f"Issue not found: {issue_id}")
        team_id = issue_node["team"]["id"]

        states_data = await self._gql.query(_TEAM_STATES_QUERY, {"teamId": team_id})
        states = states_data.get("team", {}).get("states", {}).get("nodes", [])
        for s in states:
            if s["name"].lower() == state_name.lower():
                return s["id"]

        available = [s["name"] for s in states]
        raise GraphQLError(f"State '{state_name}' not found. Available: {', '.join(available)}")

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._gql.close()

    # -- Conversion helpers --

    @staticmethod
    def _node_to_tracker_project(node: dict) -> TrackerProject:
        ms_nodes = node.get("projectMilestones", {}).get("nodes", [])
        # Calculate progress as average of milestone progress
        if ms_nodes:
            ms_progress = [_parse_progress(m.get("progress")) for m in ms_nodes]
            progress = sum(ms_progress) / len(ms_progress)
        else:
            progress = _parse_progress(node.get("progress"))

        # Extract slug from URL: .../project/{slug}-{slugId}
        slug = ""
        url = node.get("url", "")
        slug_id = node.get("slugId", "")
        if url and slug_id:
            path_part = url.rsplit("/", 1)[-1]
            if path_part.endswith(f"-{slug_id}"):
                slug = path_part[: -(len(slug_id) + 1)]

        return TrackerProject(
            id=node["id"],
            name=node.get("name", ""),
            description=node.get("description") or "",
            status=node.get("state", ""),
            url=url,
            milestone_count=len(ms_nodes),
            issue_count=len(node.get("issues", {}).get("nodes", [])),
            slug=slug,
            progress=progress,
            start_date=node.get("startDate"),
            target_date=node.get("targetDate"),
        )

    @staticmethod
    def _node_to_tracker_milestone(node: dict, project_id: str) -> TrackerMilestone:
        return TrackerMilestone(
            id=node["id"],
            project_id=project_id,
            name=node.get("name", ""),
            description=node.get("description") or "",
            sort_order=int(node.get("sortOrder", 0)),
            progress=_parse_progress(node.get("progress")),
            target_date=node.get("targetDate"),
        )

    @staticmethod
    def _node_to_tracker_issue(node: dict) -> TrackerIssue:
        state = node.get("state") or {}
        return TrackerIssue(
            id=node["id"],
            identifier=node.get("identifier", ""),
            title=node.get("title", ""),
            description=node.get("description") or "",
            status=state.get("name", "Unknown"),
            status_type=state.get("type", ""),
            assignee=(node.get("assignee") or {}).get("name"),
            labels=[n["name"] for n in (node.get("labels") or {}).get("nodes", [])],
            priority=node.get("priority", 0),
            priority_label=node.get("priorityLabel", ""),
            estimate=node.get("estimate"),
            url=node.get("url", ""),
            milestone_id=(node.get("projectMilestone") or {}).get("id"),
        )

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


def _parse_progress(value: object) -> float:
    """Parse a Linear progress value and return a 0.0–1.0 float.

    Linear returns progress as a percentage float (e.g. 8.33 = 8.33%),
    or occasionally as a string like '100%'.
    """
    if value is None:
        return 0.0
    if isinstance(value, str):
        return float(value.rstrip("%")) / 100.0
    if isinstance(value, (int, float)):
        return float(value) / 100.0
    return 0.0
