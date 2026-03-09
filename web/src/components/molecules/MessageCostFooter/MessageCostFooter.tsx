import { formatTokens } from '@/utils';
import type { ChatMessageMeta } from '@/hooks/useSkuldChat';
import styles from './MessageCostFooter.module.css';

export interface MessageCostFooterProps {
  metadata?: ChatMessageMeta;
  className?: string;
}

/**
 * Displays token usage and cost below an assistant message.
 *
 * Sums input/output tokens across all models in the usage map
 * and shows the total alongside the API cost when available.
 */
export function MessageCostFooter({ metadata, className }: MessageCostFooterProps) {
  if (!metadata?.usage) {
    return null;
  }

  const totals = Object.values(metadata.usage).reduce(
    (acc, m) => ({
      input:
        acc.input +
        (m.inputTokens ?? 0) +
        (m.cacheReadInputTokens ?? 0) +
        (m.cacheCreationInputTokens ?? 0),
      output: acc.output + (m.outputTokens ?? 0),
    }),
    { input: 0, output: 0 }
  );

  const totalTokens = totals.input + totals.output;
  if (totalTokens === 0 && metadata.cost == null) {
    return null;
  }

  return (
    <div className={className ? `${styles.footer} ${className}` : styles.footer}>
      {totalTokens > 0 && <span className={styles.stat}>{formatTokens(totalTokens)} tokens</span>}
      {totals.input > 0 && totals.output > 0 && (
        <span className={styles.breakdown}>
          ({formatTokens(totals.input)} in / {formatTokens(totals.output)} out)
        </span>
      )}
      {metadata.cost != null && <span className={styles.cost}>${metadata.cost.toFixed(4)}</span>}
    </div>
  );
}
