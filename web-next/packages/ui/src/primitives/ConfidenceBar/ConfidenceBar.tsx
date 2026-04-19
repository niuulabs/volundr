import { cn } from '../../utils/cn';
import './ConfidenceBar.css';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceBarProps {
  /** Confidence level; controls fill color. */
  level: ConfidenceLevel;
  /** Fill ratio 0–1. Clamped to [0, 1]. */
  value: number;
  /** Show the level label next to the bar. */
  showLabel?: boolean;
  className?: string;
}

const LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export function ConfidenceBar({ level, value, showLabel = false, className }: ConfidenceBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const pct = `${Math.round(clamped * 100)}%`;

  return (
    <span
      className={cn('niuu-confidence-bar', className)}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="niuu-confidence-bar__track">
        <span
          className={cn('niuu-confidence-bar__fill', `niuu-confidence-bar__fill--${level}`)}
          style={{ width: pct }}
        />
      </span>
      {showLabel && (
        <span className={cn('niuu-confidence-bar__label', `niuu-confidence-bar__label--${level}`)}>
          {LEVEL_LABELS[level]}
        </span>
      )}
    </span>
  );
}
