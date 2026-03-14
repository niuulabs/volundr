import { useState, useCallback } from 'react';

export interface TrackerIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee: string | null;
  labels: string[];
  priority: number;
  url: string;
}

interface UseIssuesResult {
  issues: TrackerIssue[];
  loading: boolean;
  error: Error | null;
  searchIssues: (query: string) => Promise<void>;
  getIssue: (issueId: string) => Promise<TrackerIssue | null>;
}

export function useIssues(): UseIssuesResult {
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const searchIssues = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/v1/volundr/issues/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        throw new Error('Failed to search issues');
      }
      const data = await resp.json();
      setIssues(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to search issues'));
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const getIssue = useCallback(async (issueId: string): Promise<TrackerIssue | null> => {
    try {
      const resp = await fetch(`/api/v1/volundr/issues/${encodeURIComponent(issueId)}`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        return null;
      }
      return await resp.json();
    } catch {
      return null;
    }
  }, []);

  return { issues, loading, error, searchIssues, getIssue };
}
