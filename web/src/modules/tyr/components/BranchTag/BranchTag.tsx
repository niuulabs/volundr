import { cn } from '@/modules/shared/utils/classnames';
import styles from './BranchTag.module.css';

export interface BranchTagProps {
  source: string;
  target?: string;
  className?: string;
}

export function BranchTag({ source, target, className }: BranchTagProps) {
  return (
    <span className={cn(styles.tag, className)}>
      <span className={styles.branch}>{source}</span>
      {target && (
        <>
          <span className={styles.arrow}>{'\u2190'}</span>
          <span className={styles.branch}>{target}</span>
        </>
      )}
    </span>
  );
}
