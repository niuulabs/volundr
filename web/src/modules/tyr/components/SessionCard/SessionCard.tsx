import { cn } from '@/modules/shared/utils/classnames';
import { StatusBadge } from '@/modules/shared';
import type { SessionInfo } from '../../models';
import { ConfBadge } from '../ConfBadge';
import { BranchTag } from '../BranchTag';
import styles from './SessionCard.module.css';

export interface SessionCardProps {
  session: SessionInfo;
  onApprove?: (sessionId: string) => void;
  onReview?: (sessionId: string) => void;
  className?: string;
}

export function SessionCard({ session, onApprove, onReview, className }: SessionCardProps) {
  return (
    <div className={cn(styles.card, className)}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.raidName}>{session.raid_name}</span>
          <span className={styles.sagaName}>{session.saga_name}</span>
        </div>
        <div className={styles.headerRight}>
          <StatusBadge status={session.status} />
          <ConfBadge value={session.confidence} />
        </div>
      </div>
      <div className={styles.meta}>
        <span className={styles.sessionId}>{session.session_id}</span>
        {session.branch && <BranchTag source={session.branch} />}
      </div>
      <div className={styles.chronicle}>
        {session.chronicle_lines.map((line, i) => (
          <div key={i} className={styles.chronicleLine}>
            {line}
          </div>
        ))}
        {session.chronicle_lines.length === 0 && (
          <div className={styles.empty}>No chronicle output</div>
        )}
      </div>
      <div className={styles.actions}>
        {onReview && session.status === 'review' && (
          <button
            type="button"
            className={styles.reviewButton}
            onClick={() => onReview(session.session_id)}
          >
            Review
          </button>
        )}
        {onApprove && (
          <button
            type="button"
            className={styles.approveButton}
            onClick={() => onApprove(session.session_id)}
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );
}
