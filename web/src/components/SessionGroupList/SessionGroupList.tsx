import { useMemo, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { getRepo } from '@/utils/source';
import { useLocalStorage } from '@/hooks';
import type { VolundrSession } from '@/models';
import styles from './SessionGroupList.module.css';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractRepoKey(repo: string): string {
  if (!repo) return '';
  try {
    const url = new URL(repo);
    // github.com/org/name → org/name
    const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    return parts;
  } catch {
    // Not a URL, use as-is
    return repo;
  }
}

interface SessionGroup {
  repoKey: string;
  sessions: VolundrSession[];
  activeCount: number;
  latestActive: number;
}

function groupSessions(sessions: VolundrSession[]): SessionGroup[] {
  const map = new Map<string, VolundrSession[]>();

  for (const session of sessions) {
    const key = extractRepoKey(getRepo(session.source)) || 'Ungrouped';
    const existing = map.get(key) ?? [];
    existing.push(session);
    map.set(key, existing);
  }

  const groups: SessionGroup[] = [];
  for (const [repoKey, groupSessions] of map) {
    // Sort sessions within group by lastActive descending
    groupSessions.sort((a, b) => b.lastActive - a.lastActive);

    const activeCount = groupSessions.filter(s => s.status === 'running').length;
    const latestActive = Math.max(...groupSessions.map(s => s.lastActive));

    groups.push({ repoKey, sessions: groupSessions, activeCount, latestActive });
  }

  // Sort groups by most recently active
  groups.sort((a, b) => b.latestActive - a.latestActive);

  return groups;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface SessionGroupListProps {
  sessions: VolundrSession[];
  searchQuery: string;
  renderSession: (session: VolundrSession) => React.ReactNode;
}

export function SessionGroupList({ sessions, searchQuery, renderSession }: SessionGroupListProps) {
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<Record<string, boolean>>(
    'volundr-session-groups-collapsed',
    {}
  );

  const isSearching = searchQuery.trim().length > 0;

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  const toggleGroup = useCallback(
    (repoKey: string) => {
      setCollapsedGroups({
        ...collapsedGroups,
        [repoKey]: !collapsedGroups[repoKey],
      });
    },
    [collapsedGroups, setCollapsedGroups]
  );

  return (
    <div className={styles.container}>
      {groups.map(group => {
        const isCollapsed = !isSearching && collapsedGroups[group.repoKey];

        return (
          <div key={group.repoKey} className={styles.group}>
            <button
              type="button"
              className={styles.groupHeader}
              onClick={() => toggleGroup(group.repoKey)}
            >
              <ChevronRight className={cn(styles.chevron, !isCollapsed && styles.chevronOpen)} />
              <span className={styles.repoName}>{group.repoKey}</span>
              {group.activeCount > 0 && (
                <span className={styles.activeBadge}>
                  <span className={styles.activeDot} />
                  {group.activeCount}
                </span>
              )}
              <span className={styles.countBadge}>{group.sessions.length}</span>
            </button>
            <div className={styles.groupItems} data-collapsed={isCollapsed}>
              {group.sessions.map(session => renderSession(session))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
