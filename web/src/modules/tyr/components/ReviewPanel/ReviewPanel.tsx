import { useState } from 'react';
import type { ReviewData, RaidMessage } from '../../hooks';
import { FeedbackChat } from '../FeedbackChat';
import styles from './ReviewPanel.module.css';

interface ReviewPanelProps {
  review: ReviewData;
  messages: RaidMessage[];
  messagesLoading: boolean;
  hasActiveSession: boolean;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onRetry: () => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
}

function scoreColor(confidence: number): string {
  if (confidence >= 0.75) return 'var(--color-accent-emerald)';
  if (confidence >= 0.45) return 'var(--color-brand)';
  return 'var(--color-accent-red)';
}

function verdictText(review: ReviewData): string {
  if (review.confidence >= 0.75) return 'Approve with comments \u2014 non-blocking nits only';
  if (review.confidence >= 0.45) return 'Minor rework needed';
  return 'Significant rework needed';
}

function extractIssues(summary: string | null): string[] {
  if (!summary) return [];
  return summary
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-') || l.startsWith('*') || l.match(/^\d+\./))
    .map(l => l.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, ''))
    .filter(Boolean)
    .slice(0, 5);
}

export function ReviewPanel({
  review,
  messages,
  messagesLoading,
  hasActiveSession,
  onApprove,
  onReject,
  onRetry,
  onSendMessage,
}: ReviewPanelProps) {
  const [showChat, setShowChat] = useState(false);
  const [acting, setActing] = useState(false);

  const issues = extractIssues(review.chronicle_summary);

  const handleAction = async (action: () => Promise<void>) => {
    setActing(true);
    try {
      await action();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Reviewer Assessment</div>
      <div className={styles.score} style={{ color: scoreColor(review.confidence) }}>
        {review.confidence.toFixed(2)}
      </div>
      <div className={styles.verdict}>{verdictText(review)}</div>

      {issues.length > 0 && (
        <ul className={styles.issues}>
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        {review.confidence >= 0.45 && (
          <button
            className={styles.btnApprove}
            onClick={() => handleAction(onApprove)}
            disabled={acting}
          >
            Approve &amp; Merge
          </button>
        )}
        {review.confidence < 0.45 && (
          <button
            className={styles.btnApprove}
            onClick={() => handleAction(onRetry)}
            disabled={acting}
          >
            Retry
          </button>
        )}
        <button
          className={styles.btnRetry}
          onClick={() => hasActiveSession && setShowChat(v => !v)}
          disabled={acting || !hasActiveSession}
          title={hasActiveSession ? undefined : 'No active session — session has ended'}
        >
          {showChat ? 'Hide Chat' : 'Send Feedback'}
        </button>
        <button
          className={styles.btnReject}
          onClick={() => handleAction(() => onReject('Rejected from dashboard'))}
          disabled={acting}
        >
          Reject
        </button>
      </div>

      {showChat && (
        <FeedbackChat messages={messages} onSend={onSendMessage} loading={messagesLoading} />
      )}
    </div>
  );
}
