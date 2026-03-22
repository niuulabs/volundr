import { useState, useEffect, useCallback } from 'react';
import type { TrackerProject, TrackerMilestone, TrackerIssue, RepoInfo } from '../models';
import { trackerService } from '../adapters';

interface UseTrackerBrowserResult {
  projects: TrackerProject[];
  selectedProject: TrackerProject | null;
  milestones: TrackerMilestone[];
  issues: TrackerIssue[];
  selectedMilestone: string | null;
  repos: RepoInfo[];
  selectedRepos: string[];
  loading: boolean;
  error: string | null;
  selectProject(projectId: string): void;
  clearProject(): void;
  filterByMilestone(milestoneId: string | null): void;
  toggleRepo(repoId: string): void;
  importProject(): Promise<void>;
}

export function useTrackerBrowser(): UseTrackerBrowserResult {
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<TrackerProject | null>(null);
  const [milestones, setMilestones] = useState<TrackerMilestone[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [projectData, repoData] = await Promise.all([
          trackerService.listProjects(),
          trackerService.listRepos(),
        ]);
        if (!cancelled) {
          setProjects(projectData);
          setRepos(repoData);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    setLoading(true);
    setError(null);
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setLoading(true);
    setError(null);
    setSelectedMilestone(null);

    Promise.all([
      trackerService.getProject(projectId),
      trackerService.listMilestones(projectId),
      trackerService.listIssues(projectId),
    ])
      .then(([project, ms, iss]) => {
        setSelectedProject(project);
        setMilestones(ms);
        setIssues(iss);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const clearProject = useCallback(() => {
    setSelectedProject(null);
    setMilestones([]);
    setIssues([]);
    setSelectedMilestone(null);
  }, []);

  const filterByMilestone = useCallback((milestoneId: string | null) => {
    setSelectedMilestone(milestoneId);
  }, []);

  const toggleRepo = useCallback((repoId: string) => {
    setSelectedRepos(prev => {
      if (prev.includes(repoId)) {
        return prev.filter(r => r !== repoId);
      }
      return [...prev, repoId];
    });
  }, []);

  const importProject = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    if (selectedRepos.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await trackerService.importProject(selectedProject.id, selectedRepos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [selectedProject, selectedRepos]);

  return {
    projects,
    selectedProject,
    milestones,
    issues,
    selectedMilestone,
    repos,
    selectedRepos,
    loading,
    error,
    selectProject,
    clearProject,
    filterByMilestone,
    toggleRepo,
    importProject,
  };
}
