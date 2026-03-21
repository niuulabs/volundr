import { ThumbsUp, ThumbsDown } from 'lucide-react';
import type { MimirConsultation } from '@/modules/volundr/models';
import { cn } from '@/utils';
import styles from './ConsultationCard.module.css';

export interface ConsultationCardProps {
  /** Consultation data */
  consultation: MimirConsultation;
  /** Whether this card is selected */
  selected?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

export function ConsultationCard({
  consultation,
  selected = false,
  onClick,
  className,
}: ConsultationCardProps) {
  const totalTokens = consultation.tokensIn + consultation.tokensOut;

  return (
    <button
      type="button"
      className={cn(styles.card, selected && styles.selected, className)}
      onClick={onClick}
    >
      <div className={styles.header}>
        <div className={styles.requesterGroup}>
          <span className={cn(styles.requester, consultation.requester === 'Odin' && styles.odin)}>
            {consultation.requester}
          </span>
          <span className={styles.arrow}>&rarr;</span>
          <span className={styles.topic}>{consultation.topic}</span>
        </div>
        <span className={styles.time}>{consultation.time}</span>
      </div>

      <p className={styles.query}>{consultation.query}</p>

      <div className={styles.footer}>
        <span className={styles.stat}>{totalTokens} tokens</span>
        <span className={styles.dot}>&middot;</span>
        <span className={styles.stat}>{consultation.latency}s</span>
        {consultation.useful ? (
          <span className={styles.useful}>
            <ThumbsUp className={styles.usefulIcon} /> useful
          </span>
        ) : (
          <span className={styles.notUseful}>
            <ThumbsDown className={styles.usefulIcon} /> not useful
          </span>
        )}
      </div>
    </button>
  );
}
