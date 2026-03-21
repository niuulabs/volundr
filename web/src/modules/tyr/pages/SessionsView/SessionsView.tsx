import { cn } from '@/modules/shared/utils/classnames';
import { LoadingIndicator } from '@/modules/shared';
import { useTyrSessions } from '../../hooks';
import { SessionCard } from '../../components/SessionCard';
import styles from './SessionsView.module.css';

export function SessionsView() {
  const { sessions, loading, error, approve } = useTyrSessions();

  if (loading) {
    return <LoadingIndicator label="Loading sessions..." />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {sessions.map((session) => (
          <SessionCard
            key={session.session_id}
            session={session}
            onApprove={approve}
          />
        ))}
      </div>
      {sessions.length === 0 && (
        <div className={styles.empty}>No active sessions</div>
      )}
    </div>
  );
}
