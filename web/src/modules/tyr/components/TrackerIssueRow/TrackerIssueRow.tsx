import { cn } from '@/modules/shared/utils/classnames';
import { StatusBadge } from '@/modules/shared';
import type { TrackerIssue } from '../../models';
import styles from './TrackerIssueRow.module.css';

export interface TrackerIssueRowProps {
  issue: TrackerIssue;
  className?: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

export function TrackerIssueRow({ issue, className }: TrackerIssueRowProps) {
  const priorityLabel = PRIORITY_LABELS[issue.priority] ?? `p${issue.priority}`;

  return (
    <div className={cn(styles.row, className)}>
      <span className={styles.identifier}>{issue.identifier}</span>
      <span className={styles.title}>{issue.title}</span>
      <StatusBadge status={issue.status} />
      <span className={styles.priority} data-priority={priorityLabel}>
        {priorityLabel}
      </span>
      {issue.assignee && <span className={styles.assignee}>{issue.assignee}</span>}
      {!issue.assignee && <span className={styles.unassigned}>unassigned</span>}
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        onClick={e => e.stopPropagation()}
      >
        {'\u2197'}
      </a>
    </div>
  );
}
