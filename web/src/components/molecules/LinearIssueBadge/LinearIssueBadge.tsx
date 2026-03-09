import { ExternalLink } from 'lucide-react';
import type { LinearIssue, LinearIssueStatus } from '@/models';
import { cn } from '@/utils';
import styles from './LinearIssueBadge.module.css';

export interface LinearIssueBadgeProps {
  issue: LinearIssue;
  className?: string;
}

const STATUS_LABELS: Record<LinearIssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function LinearIssueBadge({ issue, className }: LinearIssueBadgeProps) {
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
