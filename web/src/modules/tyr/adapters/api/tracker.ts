import type { ITrackerBrowserService } from '../../ports';
import type { TrackerProject, TrackerMilestone, TrackerIssue, Saga, RepoInfo } from '../../models';

const TRACKER_API_BASE = '/api/v1/tyr/tracker';

export class ApiTrackerBrowserService implements ITrackerBrowserService {
  async listProjects(): Promise<TrackerProject[]> {
    const res = await fetch(`${TRACKER_API_BASE}/projects`);
    if (!res.ok) {
      throw new Error(`Failed to list projects: ${res.statusText}`);
    }
    return res.json();
  }

  async getProject(projectId: string): Promise<TrackerProject> {
    const res = await fetch(`${TRACKER_API_BASE}/projects/${projectId}`);
    if (!res.ok) {
      throw new Error(`Failed to get project: ${res.statusText}`);
    }
    return res.json();
  }

  async listMilestones(projectId: string): Promise<TrackerMilestone[]> {
    const res = await fetch(`${TRACKER_API_BASE}/projects/${projectId}/milestones`);
    if (!res.ok) {
      throw new Error(`Failed to list milestones: ${res.statusText}`);
    }
    return res.json();
  }

  async listIssues(projectId: string, milestoneId?: string): Promise<TrackerIssue[]> {
    let url = `${TRACKER_API_BASE}/projects/${projectId}/issues`;
    if (milestoneId) {
      url += `?milestone_id=${encodeURIComponent(milestoneId)}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to list issues: ${res.statusText}`);
    }
    return res.json();
  }

  async listRepos(): Promise<RepoInfo[]> {
    const res = await fetch(`${TRACKER_API_BASE}/repos`);
    if (!res.ok) {
      throw new Error(`Failed to list repos: ${res.statusText}`);
    }
    return res.json();
  }

  async importProject(projectId: string, repos: string[]): Promise<Saga> {
    const res = await fetch(`${TRACKER_API_BASE}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, repos }),
    });
    if (!res.ok) {
      throw new Error(`Failed to import project: ${res.statusText}`);
    }
    return res.json();
  }
}
