import { cn } from '@/modules/shared/utils/classnames';
import type { RaidStatus } from '../../models';
import styles from './RaidBadge.module.css';

export interface RaidBadgeProps {
  status: RaidStatus;
  className?: string;
}

const statusLabels: Record<RaidStatus, string> = {
  pending: 'pending',
  queued: 'queued',
  running: '\u25CF running',
  review: '\u29D6 review',
  escalated: '\u26A0 escalated',
  merged: '\u2713 merged',
  failed: '\u2715 failed',
};

export function RaidBadge({ status, className }: RaidBadgeProps) {
  return (
    <span className={cn(styles.badge, className)} data-status={status}>
      {statusLabels[status]}
    </span>
  );
}
