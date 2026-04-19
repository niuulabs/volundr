import { cn } from '../../utils/cn';
import './ConfidenceBar.css';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceBarProps {
  level: ConfidenceLevel;
  className?: string;
}

export function ConfidenceBar({ level, className }: ConfidenceBarProps) {
  return (
    <span
      className={cn('niuu-conf-bar', `niuu-conf-bar--${level}`, className)}
      role="meter"
      aria-label={`confidence: ${level}`}
      aria-valuenow={level === 'high' ? 100 : level === 'medium' ? 60 : 25}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="niuu-conf-bar__track" aria-hidden="true">
        <span className="niuu-conf-bar__fill" />
      </span>
      <span className="niuu-conf-bar__label">{level}</span>
    </span>
  );
}
