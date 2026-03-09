import { ExternalLink, User, Tag, AlertTriangle } from 'lucide-react';
import type { LinearIssue, LinearIssueStatus } from '@/models';
import { cn } from '@/utils';
import styles from './LinearIssueSection.module.css';

export interface LinearIssueSectionProps {
  issue: LinearIssue;
  onStatusChange: (issueId: string, status: LinearIssueStatus) => void;
  className?: string;
}

const STATUS_OPTIONS: { value: LinearIssueStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

export function LinearIssueSection({ issue, onStatusChange, className }: LinearIssueSectionProps) {
  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.header}>
        <a className={styles.identifier} href={issue.url} target="_blank" rel="noopener noreferrer">
          {issue.identifier}
          <ExternalLink className={styles.linkIcon} />
        </a>
        {issue.priority !== undefined && issue.priority > 0 && (
          <span className={styles.priority} data-priority={issue.priority}>
            <AlertTriangle className={styles.priorityIcon} />
            {PRIORITY_LABELS[issue.priority]}
          </span>
        )}
      </div>

      <p className={styles.title}>{issue.title}</p>

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Status</span>
        <select
          className={styles.statusSelect}
          value={issue.status}
          onChange={e => onStatusChange(issue.id, e.target.value as LinearIssueStatus)}
          data-status={issue.status}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {issue.assignee && (
        <div className={styles.metaRow}>
          <User className={styles.metaIcon} />
          <span className={styles.metaValue}>{issue.assignee}</span>
        </div>
      )}

      {issue.labels && issue.labels.length > 0 && (
        <div className={styles.metaRow}>
          <Tag className={styles.metaIcon} />
          <div className={styles.labels}>
            {issue.labels.map(label => (
              <span key={label} className={styles.label}>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
