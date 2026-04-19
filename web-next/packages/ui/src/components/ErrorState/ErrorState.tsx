import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './ErrorState.css';

export interface ErrorStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ icon, title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cn('niuu-error-state', className)} role="alert" aria-label={title}>
      <div className="niuu-error-state__icon" aria-hidden>
        {icon ?? '⚠'}
      </div>
      <p className="niuu-error-state__title">{title}</p>
      {description && <p className="niuu-error-state__description">{description}</p>}
      {action && <div className="niuu-error-state__action">{action}</div>}
    </div>
  );
}
