import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './KpiCard.css';

export type DeltaDirection = 'up' | 'down' | 'neutral';

export interface KpiDelta {
  value: string | number;
  direction: DeltaDirection;
  label?: string;
}

export interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: KpiDelta;
  /** Optional sparkline or mini-chart — rendered as-is in the footer area */
  sparkline?: ReactNode;
  className?: string;
}

const DELTA_ICON: Record<DeltaDirection, string> = {
  up: '↑',
  down: '↓',
  neutral: '→',
};

export function KpiCard({ label, value, delta, sparkline, className }: KpiCardProps) {
  return (
    <div className={cn('niuu-kpi-card', className)}>
      <span className="niuu-kpi-card__label">{label}</span>
      <span className="niuu-kpi-card__value">{value}</span>
      {delta && (
        <span
          className={cn('niuu-kpi-card__delta', `niuu-kpi-card__delta--${delta.direction}`)}
          aria-label={`${delta.direction === 'up' ? 'Up' : delta.direction === 'down' ? 'Down' : 'No change'} ${delta.value}${delta.label ? ' ' + delta.label : ''}`}
        >
          <span className="niuu-kpi-card__delta-icon" aria-hidden>
            {DELTA_ICON[delta.direction]}
          </span>
          {delta.value}
          {delta.label && <span className="niuu-kpi-card__delta-label"> {delta.label}</span>}
        </span>
      )}
      {sparkline && <div className="niuu-kpi-card__sparkline">{sparkline}</div>}
    </div>
  );
}
