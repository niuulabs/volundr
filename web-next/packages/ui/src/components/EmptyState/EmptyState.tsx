import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './EmptyState.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('niuu-empty-state', className)} role="status" aria-label={title}>
      {icon && (
        <div className="niuu-empty-state__icon" aria-hidden>
          {icon}
        </div>
      )}
      <p className="niuu-empty-state__title">{title}</p>
      {description && <p className="niuu-empty-state__description">{description}</p>}
      {action && <div className="niuu-empty-state__action">{action}</div>}
    </div>
  );
}
