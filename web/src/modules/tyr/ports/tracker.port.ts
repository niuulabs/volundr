import type { TrackerProject, TrackerMilestone, TrackerIssue, RepoInfo } from '../models';
import type { Saga } from '../models';

export interface ITrackerBrowserService {
  listProjects(): Promise<TrackerProject[]>;
  getProject(projectId: string): Promise<TrackerProject>;
  listMilestones(projectId: string): Promise<TrackerMilestone[]>;
  listIssues(projectId: string, milestoneId?: string): Promise<TrackerIssue[]>;
  listRepos(): Promise<RepoInfo[]>;
  importProject(projectId: string, repos: string[]): Promise<Saga>;
}
