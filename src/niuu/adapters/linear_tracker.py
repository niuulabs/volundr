"""Shared Linear tracker adapter.

Implements the unified TrackerPort for the Linear GraphQL API.
Both Volundr's LinearAdapter and Tyr's LinearTrackerAdapter extend this base.
"""

from __future__ import annotations

import logging

from niuu.adapters.linear import GraphQLError, LinearGraphQLClient
from niuu.domain.models import (
    LINEAR_API_URL,
    TrackerConnectionStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from niuu.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# GraphQL fragments / queries
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

_LIST_PROJECTS_QUERY = (
    """
query ListProjects($first: Int!) {
  projects(first: $first) {
    nodes {
"""
    + _PROJECT_FIELDS
    + """
    }
  }
}
"""
)

_GET_PROJECT_QUERY = (
    """
query GetProject($id: String!) {
  project(id: $id) {
"""
    + _PROJECT_FIELDS
    + """
  }
}
"""
)

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

_LIST_ISSUES_QUERY = (
    """
query ListIssues($projectId: ID!, $first: Int!) {
  issues(
    filter: { project: { id: { eq: $projectId } } }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {
"""
    + _ISSUE_FIELDS
    + """
    }
  }
}
"""
)

_LIST_ISSUES_BY_MILESTONE_QUERY = (
    """
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
"""
    + _ISSUE_FIELDS
    + """
    }
  }
}
"""
)

_VIEWER_QUERY = """
query {
  viewer {
    id
    name
    email
  }
  organization {
    id
    name
  }
}
"""

_SEARCH_ISSUES_QUERY = """
query SearchIssues($term: String!, $first: Int!) {
  searchIssues(term: $term, first: $first) {
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
"""

_RECENT_ISSUES_QUERY = (
    """
query RecentIssues($projectId: String!, $first: Int!) {
  issues(
    filter: { project: { id: { eq: $projectId } } }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {
"""
    + _ISSUE_FIELDS
    + """
    }
  }
}
"""
)

_GET_ISSUE_QUERY = """
query GetIssue($id: String!) {
  issue(id: $id) {
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
    createdAt
    updatedAt
  }
}
"""

_UPDATE_ISSUE_STATUS_QUERY = """
mutation UpdateIssueStatus($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    issue {
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
"""

_TEAM_STATES_QUERY = """
query TeamStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes {
        id
        name
      }
    }
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_progress(value: object) -> float:
    """Parse a Linear progress value and return a 0.0-1.0 float.

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


def node_to_tracker_project(node: dict) -> TrackerProject:
    """Convert a Linear project GraphQL node to TrackerProject."""
    ms_nodes = node.get("projectMilestones", {}).get("nodes", [])
    if ms_nodes:
        ms_progress = [parse_progress(m.get("progress")) for m in ms_nodes]
        progress = sum(ms_progress) / len(ms_progress)
    else:
        progress = parse_progress(node.get("progress"))

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


def node_to_tracker_milestone(node: dict, project_id: str) -> TrackerMilestone:
    """Convert a Linear milestone GraphQL node to TrackerMilestone."""
    return TrackerMilestone(
        id=node["id"],
        project_id=project_id,
        name=node.get("name", ""),
        description=node.get("description") or "",
        sort_order=int(node.get("sortOrder", 0)),
        progress=parse_progress(node.get("progress")),
        target_date=node.get("targetDate"),
    )


def node_to_tracker_issue(node: dict) -> TrackerIssue:
    """Convert a Linear issue GraphQL node to TrackerIssue."""
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


# ---------------------------------------------------------------------------
# Shared adapter base
# ---------------------------------------------------------------------------


class LinearTrackerBase(TrackerPort):
    """Linear tracker base implementing the shared TrackerPort.

    Provides project browsing, issue search, and status management.
    Tyr's adapter extends this with saga/phase/raid CRUD operations.
    """

    def __init__(
        self,
        api_key: str,
        api_url: str = LINEAR_API_URL,
        cache_ttl: float = 30.0,
        max_retries: int = 3,
        **_extra: object,
    ) -> None:
        self._gql = LinearGraphQLClient(
            api_key=api_key,
            api_url=api_url,
            cache_ttl=cache_ttl,
            max_retries=max_retries,
        )

    @property
    def provider_name(self) -> str:
        return "linear"

    # -- Connection -------------------------------------------------------

    async def check_connection(self) -> TrackerConnectionStatus:
        cached = self._gql.get_cached("connection")
        if cached is not None:
            return cached  # type: ignore[return-value]

        try:
            data = await self._gql.query(_VIEWER_QUERY)
            viewer = data.get("viewer", {})
            org = data.get("organization", {})
            result = TrackerConnectionStatus(
                connected=True,
                provider="linear",
                workspace=org.get("name"),
                user=viewer.get("name"),
            )
            self._gql.set_cached("connection", result, ttl=300.0)
            return result
        except Exception:
            logger.exception("Linear connection check failed")
            return TrackerConnectionStatus(connected=False, provider="linear")

    # -- Issue search / get -----------------------------------------------

    async def search_issues(
        self,
        query: str,
        project_id: str | None = None,
    ) -> list[TrackerIssue]:
        cache_key = f"search:{query}:{project_id}"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        search_term = query
        if project_id:
            search_term = f"project:{project_id} {query}"

        data = await self._gql.query(
            _SEARCH_ISSUES_QUERY,
            {"term": search_term, "first": 25},
        )
        nodes = data.get("searchIssues", {}).get("nodes", [])
        issues = [node_to_tracker_issue(n) for n in nodes]
        self._gql.set_cached(cache_key, issues, ttl=30.0)
        return issues

    async def get_recent_issues(
        self,
        project_id: str,
        limit: int = 10,
    ) -> list[TrackerIssue]:
        cache_key = f"recent:{project_id}:{limit}"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        data = await self._gql.query(
            _RECENT_ISSUES_QUERY,
            {"projectId": project_id, "first": limit},
        )
        nodes = data.get("issues", {}).get("nodes", [])
        issues = [node_to_tracker_issue(n) for n in nodes]
        self._gql.set_cached(cache_key, issues, ttl=30.0)
        return issues

    async def get_issue(self, issue_id: str) -> TrackerIssue | None:
        try:
            data = await self._gql.query(_GET_ISSUE_QUERY, {"id": issue_id})
            node = data.get("issue")
            if node is None:
                return None
            return node_to_tracker_issue(node)
        except GraphQLError:
            return None

    # -- Issue status update ----------------------------------------------

    async def update_issue_status(
        self,
        issue_id: str,
        status: str,
    ) -> TrackerIssue:
        state_id = await self._resolve_state_id(issue_id, status)
        data = await self._gql.query(
            _UPDATE_ISSUE_STATUS_QUERY,
            {"issueId": issue_id, "stateId": state_id},
        )
        updated = data.get("issueUpdate", {}).get("issue")
        if updated is None:
            raise GraphQLError("Failed to update issue status")

        self._gql.invalidate_cache("search:")
        self._gql.invalidate_cache("recent:")
        self._gql.invalidate_cache("issues:")

        return node_to_tracker_issue(updated)

    # -- Project browsing -------------------------------------------------

    async def list_projects(self) -> list[TrackerProject]:
        cache_key = "projects:all"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        data = await self._gql.query(_LIST_PROJECTS_QUERY, {"first": 50})
        nodes = data.get("projects", {}).get("nodes", [])
        projects = [node_to_tracker_project(n) for n in nodes]
        self._gql.set_cached(cache_key, projects)
        return projects

    async def get_project(self, project_id: str) -> TrackerProject:
        data = await self._gql.query(_GET_PROJECT_QUERY, {"id": project_id})
        project = data.get("project")
        if project is None:
            raise GraphQLError(f"Project not found: {project_id}")
        return node_to_tracker_project(project)

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        cache_key = f"milestones:{project_id}"
        cached = self._gql.get_cached(cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        data = await self._gql.query(_LIST_MILESTONES_QUERY, {"projectId": project_id})
        nodes = data.get("project", {}).get("projectMilestones", {}).get("nodes", [])
        milestones = [node_to_tracker_milestone(n, project_id) for n in nodes]
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
                {
                    "projectId": project_id,
                    "milestoneId": milestone_id,
                    "first": 100,
                },
            )
        else:
            data = await self._gql.query(
                _LIST_ISSUES_QUERY,
                {"projectId": project_id, "first": 100},
            )

        nodes = data.get("issues", {}).get("nodes", [])
        issues = [node_to_tracker_issue(n) for n in nodes]
        self._gql.set_cached(cache_key, issues)
        return issues

    async def get_project_full(
        self, project_id: str
    ) -> tuple[TrackerProject, list[TrackerMilestone], list[TrackerIssue]]:
        """Fetch project, milestones, and issues in a single GraphQL call."""
        data = await self._gql.query(
            _GET_PROJECT_FULL_QUERY,
            {"id": project_id, "issueFirst": 250},
        )
        project_node = data.get("project")
        if project_node is None:
            raise GraphQLError(f"Project not found: {project_id}")

        project_for_counts = {
            **project_node,
            "issues": project_node.get("issueCount", {}),
        }
        project = node_to_tracker_project(project_for_counts)

        ms_nodes = project_node.get("projectMilestones", {}).get("nodes", [])
        milestones = [node_to_tracker_milestone(n, project_id) for n in ms_nodes]
        milestones.sort(key=lambda m: m.sort_order)

        issue_nodes = project_node.get("issuesFull", {}).get("nodes", [])
        issues = [node_to_tracker_issue(n) for n in issue_nodes]

        return project, milestones, issues

    # -- Internal helpers -------------------------------------------------

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
