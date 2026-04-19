import { cn } from '../../utils/cn';
import './ConfidenceBadge.css';

export interface ConfidenceBadgeProps {
  /** Confidence ratio 0–1, or null/0 to render em-dash. */
  value: number | null;
  className?: string;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

function toLevel(value: number): ConfidenceLevel {
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'medium';
  return 'low';
}

export function ConfidenceBadge({ value, className }: ConfidenceBadgeProps) {
  const isEmpty = value === null || value === 0;

  if (isEmpty) {
    return (
      <span className={cn('niuu-confidence-badge', 'niuu-confidence-badge--empty', className)}>
        —
      </span>
    );
  }

  const clamped = Math.min(1, Math.max(0, value));
  const level = toLevel(clamped);
  const pct = `${Math.round(clamped * 100)}%`;

  return (
    <span
      className={cn('niuu-confidence-badge', className)}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="niuu-confidence-badge__track">
        <span
          className={cn('niuu-confidence-badge__fill', `niuu-confidence-badge__fill--${level}`)}
          style={{ width: pct }}
        />
      </span>
      <span className={cn('niuu-confidence-badge__pct', `niuu-confidence-badge__pct--${level}`)}>
        {pct}
      </span>
    </span>
  );
}
