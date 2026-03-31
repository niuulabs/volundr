package tracker

// GraphQL queries for the Linear API, ported from
// src/tyr/adapters/linear.py

const projectFields = `
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
`

const issueFields = `
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
`

var qListProjects = `
query ListProjects($first: Int!) {
  projects(first: $first) {
    nodes {` + projectFields + `
    }
  }
}`

var qGetProject = `
query GetProject($id: String!) {
  project(id: $id) {` + projectFields + `
  }
}`

var qListMilestones = `
query ListMilestones($projectId: ID!) {
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
}`

var qGetProjectFull = `
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
        nodes {` + issueFields + `
        }
      }
  }
}`

var qListIssues = `
query ListIssues($projectId: ID!, $first: Int!) {
  issues(
    filter: { project: { id: { eq: $projectId } } }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {` + issueFields + `
    }
  }
}`

var qListIssuesByMilestone = `
query ListIssuesByMilestone($projectId: ID!, $milestoneId: ID!, $first: Int!) {
  issues(
    filter: {
      project: { id: { eq: $projectId } }
      projectMilestone: { id: { eq: $milestoneId } }
    }
    first: $first
    orderBy: updatedAt
  ) {
    nodes {` + issueFields + `
    }
  }
}`

var qCreateProject = `
mutation CreateProject($name: String!, $description: String, $teamIds: [String!]!) {
  projectCreate(input: { name: $name, description: $description, teamIds: $teamIds }) {
    project { id }
    success
  }
}`

var qCreateMilestone = `
mutation CreateMilestone($name: String!, $projectId: String!, $sortOrder: Float!) {
  projectMilestoneCreate(input: { name: $name, projectId: $projectId, sortOrder: $sortOrder }) {
    projectMilestone { id }
    success
  }
}`

var qCreateIssue = `
mutation CreateIssue(
  $title: String!,
  $description: String,
  $projectId: String!,
  $projectMilestoneId: String,
  $teamId: String!,
  $estimate: Int
) {
  issueCreate(input: {
    title: $title,
    description: $description,
    projectId: $projectId,
    projectMilestoneId: $projectMilestoneId,
    teamId: $teamId,
    estimate: $estimate
  }) {
    issue { id identifier }
    success
  }
}`

var qUpdateIssueState = `
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    issue { id state { name } }
    success
  }
}`

var qIssueTeam = `
query IssueTeam($id: String!) {
  issue(id: $id) {
    team { id }
  }
}`

var qTeamStates = `
query TeamStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes { id name }
    }
  }
}`

var qAddComment = `
mutation AddComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
  }
}`
