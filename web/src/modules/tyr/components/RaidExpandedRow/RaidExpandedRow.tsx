import { LoadingIndicator } from '@/modules/shared';
import { useRaidReview, useRaidMessages } from '../../hooks';
import { useSessionTimeline } from '../../hooks/useSessionTimeline';
import type { RaidStatus } from '../../models';
import { RaidTimeline } from '../RaidTimeline';
import { ReviewPanel } from '../ReviewPanel';
import styles from './RaidExpandedRow.module.css';

interface RaidExpandedRowProps {
  raidId: string;
  status: RaidStatus;
  sessionId: string | null;
  onAction: () => void;
}

export function RaidExpandedRow({ raidId, status, sessionId, onAction }: RaidExpandedRowProps) {
  const { review, loading, error, approve, reject, retry } = useRaidReview(raidId);
  const { messages, loading: msgsLoading, sendMessage } = useRaidMessages(raidId);
  const { timeline } = useSessionTimeline(sessionId);

  if (loading) {
    return (
      <div className={styles.detail}>
        <LoadingIndicator messages={['Loading review data...']} />
      </div>
    );
  }

  if (error) {
    return <div className={styles.detail}>Failed to load: {error}</div>;
  }

  const hasReview =
    review && (status === 'review' || status === 'escalated' || status === 'merged');

  return (
    <div className={styles.detail}>
      <RaidTimeline
        confidenceEvents={review?.confidence_events ?? []}
        sessionEvents={timeline?.events}
        status={status}
        sessionId={sessionId}
      />
      {hasReview && (
        <ReviewPanel
          review={review}
          messages={messages}
          messagesLoading={msgsLoading}
          hasActiveSession={false}
          onApprove={async () => {
            await approve();
            onAction();
          }}
          onReject={async reason => {
            await reject(reason);
            onAction();
          }}
          onRetry={async () => {
            await retry();
            onAction();
          }}
          onSendMessage={sendMessage}
        />
      )}
    </div>
  );
}
