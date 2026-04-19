import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './LoadingState.css';

export interface LoadingStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function LoadingState({
  title = 'Loading…',
  description,
  action,
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn('niuu-loading-state', className)}
      role="status"
      aria-label={title}
      aria-live="polite"
    >
      <span className="niuu-loading-state__spinner" aria-hidden />
      <p className="niuu-loading-state__title">{title}</p>
      {description && <p className="niuu-loading-state__description">{description}</p>}
      {action && <div className="niuu-loading-state__action">{action}</div>}
    </div>
  );
}
