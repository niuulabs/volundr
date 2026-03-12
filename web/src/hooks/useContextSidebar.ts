import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  VolundrSession,
  SessionChronicle,
  SessionSource,
  PullRequest,
  McpServer,
  ChronicleEvent,
} from '@/models';
import { TASK_TYPES } from '@/models';
import { volundrService } from '@/adapters';
import { useLocalStorage } from './useLocalStorage';

export interface TokenUsageData {
  totalTokens: number;
  burnRate: number[];
  peakBurn: number;
  averageBurn: number;
}

export interface ActiveTask {
  label: string;
  timestamp: number;
}

export interface ModelConfigData {
  model: string;
  taskType: string;
  taskDescription: string;
  source: SessionSource;
}

export interface UseContextSidebarResult {
  collapsed: boolean;
  toggleCollapsed: () => void;
  tokenUsage: TokenUsageData | null;
  activeTasks: ActiveTask[];
  pullRequest: PullRequest | null;
  mcpServers: McpServer[];
  mcpServersLoading: boolean;
  modelConfig: ModelConfigData | null;
}

function extractActiveTasks(events: ChronicleEvent[]): ActiveTask[] {
  return events
    .filter(e => e.type === 'session' || e.type === 'message')
    .slice(-5)
    .map(e => ({ label: e.label, timestamp: e.t }));
}

function computeTokenUsage(session: VolundrSession, chronicle: SessionChronicle): TokenUsageData {
  const burnRate = chronicle.tokenBurn;
  const peakBurn = burnRate.length > 0 ? Math.max(...burnRate) : 0;
  const averageBurn =
    burnRate.length > 0 ? Math.round(burnRate.reduce((a, b) => a + b, 0) / burnRate.length) : 0;

  return {
    totalTokens: session.tokensUsed,
    burnRate,
    peakBurn,
    averageBurn,
  };
}

function buildModelConfig(session: VolundrSession): ModelConfigData {
  const taskType = session.taskType ?? 'unknown';
  const taskDef = TASK_TYPES[taskType];

  return {
    model: session.model,
    taskType: taskDef?.name ?? taskType,
    taskDescription: taskDef?.description ?? '',
    source: session.source,
  };
}

export function useContextSidebar(
  session: VolundrSession | null,
  chronicle: SessionChronicle | null,
  pullRequest: PullRequest | null
): UseContextSidebarResult {
  const [collapsed, setCollapsed] = useLocalStorage('context-sidebar-collapsed', false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpServersLoading, setMcpServersLoading] = useState(false);
  const sessionId = session?.id ?? null;
  const cancelRef = useRef<(() => void) | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  const fetchMcpServers = useCallback(async (sid: string) => {
    // Cancel any in-flight request
    if (cancelRef.current) {
      cancelRef.current();
    }

    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };

    setMcpServersLoading(true);
    try {
      const servers = await volundrService.getSessionMcpServers(sid);
      if (!cancelled) {
        setMcpServers(servers);
      }
    } catch {
      if (!cancelled) {
        setMcpServers([]);
      }
    } finally {
      if (!cancelled) {
        setMcpServersLoading(false);
      }
    }
  }, []);

  // Fetch MCP servers when session changes
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    fetchMcpServers(sessionId);

    return () => {
      if (cancelRef.current) {
        cancelRef.current();
        cancelRef.current = null;
      }
    };
  }, [sessionId, fetchMcpServers]);

  const tokenUsage = useMemo(() => {
    if (!session || !chronicle) {
      return null;
    }
    return computeTokenUsage(session, chronicle);
  }, [session, chronicle]);

  const activeTasks = useMemo(() => {
    if (!chronicle) {
      return [];
    }
    return extractActiveTasks(chronicle.events);
  }, [chronicle]);

  const modelConfig = useMemo(() => {
    if (!session) {
      return null;
    }
    return buildModelConfig(session);
  }, [session]);

  // When session is absent, return empty servers (the effect won't run,
  // so stale state may remain in the state variable).
  const effectiveMcpServers = sessionId ? mcpServers : [];
  const effectiveMcpLoading = sessionId ? mcpServersLoading : false;

  return {
    collapsed,
    toggleCollapsed,
    tokenUsage,
    activeTasks,
    pullRequest,
    mcpServers: effectiveMcpServers,
    mcpServersLoading: effectiveMcpLoading,
    modelConfig,
  };
}
