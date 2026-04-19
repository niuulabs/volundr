import { cn } from '../../utils/cn';
import './StatusBadge.css';

export type StatusBadgeStatus = 'running' | 'queued' | 'ok' | 'review' | 'failed' | 'archived';

export interface StatusBadgeProps {
  status: StatusBadgeStatus;
  className?: string;
}

const STATUS_LABELS: Record<StatusBadgeStatus, string> = {
  running: 'running',
  queued: 'queued',
  ok: 'ok',
  review: 'review',
  failed: 'failed',
  archived: 'archived',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn('niuu-status-badge', `niuu-status-badge--${status}`, className)}
      role="status"
      aria-label={status}
    >
      <span className="niuu-status-badge__dot" aria-hidden="true" />
      <span className="niuu-status-badge__label">{STATUS_LABELS[status]}</span>
    </span>
  );
}
