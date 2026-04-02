import { createApiClient } from '@/modules/shared/api/client';
import type { ITrackerBrowserService } from '../../ports';
import type { TrackerProject, TrackerMilestone, TrackerIssue, Saga } from '../../models';

const api = createApiClient('/api/v1/tyr/tracker');

export class ApiTrackerBrowserService implements ITrackerBrowserService {
  async listProjects(): Promise<TrackerProject[]> {
    return api.get<TrackerProject[]>('/projects');
  }

  async getProject(projectId: string): Promise<TrackerProject> {
    return api.get<TrackerProject>(`/projects/${projectId}`);
  }

  async listMilestones(projectId: string): Promise<TrackerMilestone[]> {
    return api.get<TrackerMilestone[]>(`/projects/${projectId}/milestones`);
  }

  async listIssues(projectId: string, milestoneId?: string): Promise<TrackerIssue[]> {
    const query = milestoneId ? `?milestone_id=${encodeURIComponent(milestoneId)}` : '';
    return api.get<TrackerIssue[]>(`/projects/${projectId}/issues${query}`);
  }

  async importProject(projectId: string, repos: string[], baseBranch?: string): Promise<Saga> {
    return api.post<Saga>('/import', { project_id: projectId, repos, base_branch: baseBranch });
  }
}
