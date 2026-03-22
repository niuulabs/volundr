import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';
import type {
  TrackerProject,
  TrackerMilestone,
  TrackerIssue,
  RepoInfo,
  SelectedRepo,
} from '../models';
import { trackerService } from '../adapters';

const niuuApi = createApiClient('/api/v1/niuu');
const sagasApi = createApiClient('/api/v1/tyr/sagas');

interface ImportedSaga {
  id: string;
  tracker_id: string;
}

interface UseTrackerBrowserResult {
  projects: TrackerProject[];
  selectedProject: TrackerProject | null;
  milestones: TrackerMilestone[];
  issues: TrackerIssue[];
  selectedMilestone: string | null;
  repos: RepoInfo[];
  selectedRepos: SelectedRepo[];
  importedTrackerIds: Set<string>;
  loading: boolean;
  error: string | null;
  selectProject(projectId: string): void;
  clearProject(): void;
  filterByMilestone(milestoneId: string | null): void;
  toggleRepo(repoId: string): void;
  setBranch(repoId: string, branch: string): void;
  importProject(): Promise<void>;
}

export function useTrackerBrowser(): UseTrackerBrowserResult {
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<TrackerProject | null>(null);
  const [milestones, setMilestones] = useState<TrackerMilestone[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<SelectedRepo[]>([]);
  const [importedTrackerIds, setImportedTrackerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [projectData, reposByProvider, sagas] = await Promise.all([
          trackerService.listProjects(),
          niuuApi.get<Record<string, RepoInfo[]>>('/repos'),
          sagasApi.get<ImportedSaga[]>(''),
        ]);
        if (!cancelled) {
          setProjects(projectData);
          const flatRepos = Object.values(reposByProvider).flat();
          setRepos(flatRepos);
          setImportedTrackerIds(new Set(sagas.map(s => s.tracker_id)));
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

  const toggleRepo = useCallback(
    (repoId: string) => {
      setSelectedRepos(prev => {
        const existing = prev.find(r => r.repoId === repoId);
        if (existing) {
          return prev.filter(r => r.repoId !== repoId);
        }
        const repo = repos.find(r => `${r.org}/${r.name}` === repoId);
        return [...prev, { repoId, branch: repo?.default_branch ?? 'main' }];
      });
    },
    [repos]
  );

  const setBranch = useCallback((repoId: string, branch: string) => {
    setSelectedRepos(prev => prev.map(r => (r.repoId === repoId ? { ...r, branch } : r)));
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
      await trackerService.importProject(
        selectedProject.id,
        selectedRepos.map(r => r.repoId)
      );
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
    importedTrackerIds,
    loading,
    error,
    selectProject,
    clearProject,
    filterByMilestone,
    toggleRepo,
    setBranch,
    importProject,
  };
}
