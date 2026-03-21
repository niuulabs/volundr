import { cn } from '@/modules/shared/utils/classnames';
import type { Raid } from '../../models';
import { ConfBadge } from '../ConfBadge';
import { RaidBadge } from '../RaidBadge';
import { BranchTag } from '../BranchTag';
import styles from './RaidRow.module.css';

export interface RaidRowProps {
  raid: Raid;
  autoMergeThreshold?: number;
  className?: string;
}

const DEFAULT_AUTO_MERGE_THRESHOLD = 0.95;

export function RaidRow({
  raid,
  autoMergeThreshold = DEFAULT_AUTO_MERGE_THRESHOLD,
  className,
}: RaidRowProps) {
  const showAutoMerge = raid.confidence >= autoMergeThreshold && raid.status === 'review';
  return (
    <div className={cn(styles.row, className)}>
      <span className={styles.name}>{raid.name}</span>
      <ConfBadge value={raid.confidence} />
      <RaidBadge status={raid.status} />
      {raid.branch && <BranchTag source={raid.branch} />}
      {showAutoMerge && <span className={styles.autoMerge}>auto-merge</span>}
    </div>
  );
}
