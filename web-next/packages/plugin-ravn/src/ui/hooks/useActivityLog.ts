import { useMemo } from 'react';
import { useSessions } from './useSessions';
import { useTriggers } from './useTriggers';
import type { ActivityLogEntry } from '../../domain/activityLog';
import type { Session } from '../../domain/session';
import type { Trigger } from '../../domain/trigger';

const ACTIVITY_LOG_ROWS = 9;

function sessionToEntry(s: Session): ActivityLogEntry {
  const kind = s.status === 'failed' ? 'emit' : 'session';
  return {
    id: `session-${s.id}`,
    ts: s.createdAt,
    kind,
    ravnId: s.ravnId.slice(0, 8),
    message: s.title ?? `session ${s.id.slice(0, 8)}`,
  };
}

function triggerToEntry(t: Trigger): ActivityLogEntry {
  return {
    id: `trigger-${t.id}`,
    ts: t.createdAt,
    kind: 'trigger',
    ravnId: t.personaName.slice(0, 8),
    message: `${t.kind}: ${t.spec}`,
  };
}

/**
 * Derives recent fleet activity from sessions and triggers.
 * Returns up to 9 entries sorted by timestamp descending.
 */
export function useActivityLog(): {
  data: ActivityLogEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const sessions = useSessions();
  const triggers = useTriggers();

  const data = useMemo((): ActivityLogEntry[] | undefined => {
    if (!sessions.data) return undefined;

    const entries: ActivityLogEntry[] = sessions.data.map(sessionToEntry);

    if (triggers.data) {
      for (const t of triggers.data) {
        entries.push(triggerToEntry(t));
      }
    }

    return entries.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, ACTIVITY_LOG_ROWS);
  }, [sessions.data, triggers.data]);

  return { data, isLoading: sessions.isLoading, isError: sessions.isError };
}
