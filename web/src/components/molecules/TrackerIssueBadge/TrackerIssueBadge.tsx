import { ExternalLink } from 'lucide-react';
import type { TrackerIssue, TrackerIssueStatus } from '@/models';
import { cn } from '@/utils';
import styles from './TrackerIssueBadge.module.css';

export interface TrackerIssueBadgeProps {
  issue: TrackerIssue;
  className?: string;
}

const STATUS_LABELS: Record<TrackerIssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function TrackerIssueBadge({ issue, className }: TrackerIssueBadgeProps) {
  return (
    <a
      className={cn(styles.badge, className)}
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      data-status={issue.status}
      title={`${issue.identifier}: ${issue.title} (${STATUS_LABELS[issue.status]})`}
    >
      <span className={styles.identifier}>{issue.identifier}</span>
      <ExternalLink className={styles.icon} />
    </a>
  );
}
