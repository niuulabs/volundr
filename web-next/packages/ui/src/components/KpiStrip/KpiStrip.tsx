import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './KpiStrip.css';

export interface KpiStripProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function KpiStrip({ children, className, ...rest }: KpiStripProps) {
  return (
    <div
      className={cn('niuu-kpi-strip', className)}
      role="group"
      aria-label="KPI metrics"
      {...rest}
    >
      {children}
    </div>
  );
}
