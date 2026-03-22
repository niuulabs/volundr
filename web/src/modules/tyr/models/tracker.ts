export interface TrackerProject {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  milestone_count: number;
  issue_count: number;
}

export interface TrackerMilestone {
  id: string;
  project_id: string;
  name: string;
  description: string;
  sort_order: number;
  progress: number;
}

export interface TrackerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  assignee: string | null;
  labels: string[];
  priority: number;
  url: string;
  milestone_id: string | null;
}
