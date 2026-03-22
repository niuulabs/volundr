import { cn } from '@/modules/shared/utils/classnames';
import type { TrackerMilestone, TrackerIssue } from '../../models';
import { TrackerIssueRow } from '../TrackerIssueRow';
import styles from './MilestoneRow.module.css';

export interface MilestoneRowProps {
  milestone: TrackerMilestone;
  issues: TrackerIssue[];
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}

export function MilestoneRow({
  milestone,
  issues,
  expanded,
  onToggle,
  className,
}: MilestoneRowProps) {
  const progressPercent = Math.round(milestone.progress * 100);

  return (
    <div className={cn(styles.container, className)}>
      <button type="button" className={styles.header} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.chevron} data-expanded={expanded}>
          {'\u25B6'}
        </span>
        <span className={styles.name}>{milestone.name}</span>
        <span className={styles.issueCount}>{issues.length} issues</span>
        <span className={styles.progressWrapper}>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </span>
          <span className={styles.progressLabel}>{progressPercent}%</span>
        </span>
      </button>
      {expanded && (
        <div className={styles.content}>
          {issues.map(issue => (
            <TrackerIssueRow key={issue.id} issue={issue} />
          ))}
          {issues.length === 0 && <div className={styles.empty}>No issues in this milestone</div>}
        </div>
      )}
    </div>
  );
}
