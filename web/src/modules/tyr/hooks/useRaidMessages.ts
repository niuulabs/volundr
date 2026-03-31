import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr');

export interface RaidMessage {
  id: string;
  session_id: string;
  content: string;
  sender: string;
  created_at: string;
}

interface UseRaidMessagesResult {
  messages: RaidMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
}

export function useRaidMessages(raidId: string | null): UseRaidMessagesResult {
  const [messages, setMessages] = useState<RaidMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<RaidMessage[]>(`/raids/${id}/messages`);
      setMessages(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!raidId) return;
    fetchMessages(raidId);
  }, [raidId, fetchMessages]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!raidId) return;
      const resp = await api.post<RaidMessage>(`/raids/${raidId}/message`, {
        content,
      });
      setMessages(prev => [...prev, resp]);
    },
    [raidId]
  );

  return { messages, loading, error, sendMessage };
}
