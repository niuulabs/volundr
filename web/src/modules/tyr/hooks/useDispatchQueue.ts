import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr/dispatch');

export interface QueueItem {
  saga_id: string;
  saga_name: string;
  saga_slug: string;
  repos: string[];
  feature_branch: string;
  phase_name: string;
  issue_id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  priority_label: string;
  estimate: number | null;
  url: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface DispatchDefaults {
  default_system_prompt: string;
  default_model: string;
  models: ModelOption[];
}

interface DispatchItem {
  saga_id: string;
  issue_id: string;
  repo: string;
}

interface DispatchResult {
  issue_id: string;
  session_id: string;
  session_name: string;
  status: string;
}

interface UseDispatchQueueResult {
  queue: QueueItem[];
  defaults: DispatchDefaults;
  loading: boolean;
  error: string | null;
  dispatching: boolean;
  refresh: () => void;
  dispatch: (
    items: DispatchItem[],
    model: string,
    systemPrompt: string
  ) => Promise<DispatchResult[]>;
}

export function useDispatchQueue(): UseDispatchQueueResult {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [defaults, setDefaults] = useState<DispatchDefaults>({
    default_system_prompt: '',
    default_model: 'claude-sonnet-4-6',
    models: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueData, configData] = await Promise.all([
        api.get<QueueItem[]>('/queue'),
        api.get<DispatchDefaults>('/config'),
      ]);
      setQueue(queueData);
      setDefaults(configData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const dispatch = useCallback(
    async (
      items: DispatchItem[],
      model: string,
      systemPrompt: string
    ): Promise<DispatchResult[]> => {
      setDispatching(true);
      try {
        const results = await api.post<DispatchResult[]>('/approve', {
          items,
          model,
          system_prompt: systemPrompt,
        });
        // Remove dispatched items from queue locally
        const dispatched = new Set(
          results.filter(r => r.status === 'spawned').map(r => r.issue_id)
        );
        setQueue(prev => prev.filter(q => !dispatched.has(q.issue_id)));
        return results;
      } finally {
        setDispatching(false);
      }
    },
    []
  );

  return { queue, defaults, loading, error, dispatching, refresh: fetchQueue, dispatch };
}
