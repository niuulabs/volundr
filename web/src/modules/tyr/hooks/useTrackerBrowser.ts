import { useState, useEffect, useCallback } from 'react';
import type { TrackerProject, TrackerMilestone, TrackerIssue } from '../models';
import { trackerService } from '../adapters';

interface UseTrackerBrowserResult {
  projects: TrackerProject[];
  selectedProject: TrackerProject | null;
  milestones: TrackerMilestone[];
  issues: TrackerIssue[];
  selectedMilestone: string | null;
  loading: boolean;
  error: string | null;
  selectProject(projectId: string): void;
  clearProject(): void;
  filterByMilestone(milestoneId: string | null): void;
  importProject(repo: string, featureBranch: string): Promise<void>;
}

export function useTrackerBrowser(): UseTrackerBrowserResult {
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<TrackerProject | null>(null);
  const [milestones, setMilestones] = useState<TrackerMilestone[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await trackerService.listProjects();
        if (!cancelled) {
          setProjects(data);
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
    fetch();
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

  const importProject = useCallback(
    async (repo: string, featureBranch: string) => {
      if (!selectedProject) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await trackerService.importProject(selectedProject.id, repo, featureBranch);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [selectedProject]
  );

  return {
    projects,
    selectedProject,
    milestones,
    issues,
    selectedMilestone,
    loading,
    error,
    selectProject,
    clearProject,
    filterByMilestone,
    importProject,
  };
}
