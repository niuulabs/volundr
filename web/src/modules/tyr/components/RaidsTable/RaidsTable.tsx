import { StatusBadge } from '@/modules/shared';
import { ConfBadge } from '../ConfBadge';
import { RaidExpandedRow } from '../RaidExpandedRow';
import type { ActiveRaid } from '../../hooks';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './RaidsTable.module.css';

interface RaidsTableProps {
  raids: ActiveRaid[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onAction: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function RaidsTable({ raids, expandedId, onToggle, onAction }: RaidsTableProps) {
  if (raids.length === 0) {
    return <div className={styles.empty}>No active raids</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.cTicket}>Ticket</th>
          <th className={styles.cStatus}>Status</th>
          <th className={styles.cConf}>Confidence</th>
          <th className={styles.cSession}>Session</th>
          <th className={styles.cPr}>PR</th>
          <th className={styles.cTime} />
        </tr>
      </thead>
      <tbody>
        {raids.map(raid => {
          const isExpanded = expandedId === raid.tracker_id;
          return (
            <RaidRowGroup
              key={raid.tracker_id}
              raid={raid}
              expanded={isExpanded}
              onToggle={() => onToggle(raid.tracker_id)}
              onAction={onAction}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function RaidRowGroup({
  raid,
  expanded,
  onToggle,
  onAction,
}: {
  raid: ActiveRaid;
  expanded: boolean;
  onToggle: () => void;
  onAction: () => void;
}) {
  return (
    <>
      <tr className={cn(styles.row, expanded && styles.expanded)} onClick={onToggle}>
        <td className={styles.cTicket}>
          {raid.url ? (
            <a
              href={raid.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.raidId}
              onClick={e => e.stopPropagation()}
            >
              {raid.identifier || raid.tracker_id}
            </a>
          ) : (
            <div className={styles.raidId}>{raid.identifier || raid.tracker_id}</div>
          )}
          <div className={styles.raidTitle}>{raid.title}</div>
        </td>
        <td className={styles.cStatus}>
          <StatusBadge status={raid.status} />
        </td>
        <td className={styles.cConf}>
          <ConfBadge value={raid.confidence} />
        </td>
        <td className={styles.cSession}>
          {raid.session_id ? (
            <span className={styles.sessionId}>{raid.session_id.slice(0, 8)}</span>
          ) : (
            <span className={styles.muted}>&mdash;</span>
          )}
        </td>
        <td className={styles.cPr}>
          {raid.pr_url ? (
            <a
              href={raid.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.prLink}
              onClick={e => e.stopPropagation()}
            >
              PR
            </a>
          ) : (
            <span className={styles.muted}>&mdash;</span>
          )}
        </td>
        <td className={styles.cTime}>
          <span className={styles.time}>{relativeTime(raid.last_updated)}</span>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.expandRow}>
          <td colSpan={6}>
            <RaidExpandedRow
              raidId={raid.tracker_id}
              status={raid.status}
              sessionId={raid.session_id}
              onAction={onAction}
            />
          </td>
        </tr>
      )}
    </>
  );
}
