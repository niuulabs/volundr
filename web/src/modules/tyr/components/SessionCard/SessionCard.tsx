import { cn } from '@/modules/shared/utils/classnames';
import { StatusBadge } from '@/modules/shared';
import type { SessionInfo } from '../../models';
import styles from './SessionCard.module.css';

export interface SessionCardProps {
  session: SessionInfo;
  onApprove?: (sessionId: string) => void;
  className?: string;
}

export function SessionCard({ session, onApprove, className }: SessionCardProps) {
  return (
    <div className={cn(styles.card, className)}>
      <div className={styles.header}>
        <span className={styles.sessionId}>{session.session_id}</span>
        <StatusBadge status={session.status} />
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
