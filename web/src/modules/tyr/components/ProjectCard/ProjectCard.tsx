import { cn } from '@/modules/shared/utils/classnames';
import { StatusBadge } from '@/modules/shared';
import type { TrackerProject } from '../../models';
import styles from './ProjectCard.module.css';

export interface ProjectCardProps {
  project: TrackerProject;
  onClick: () => void;
  className?: string;
}

export function ProjectCard({ project, onClick, className }: ProjectCardProps) {
  return (
    <button type="button" className={cn(styles.card, className)} onClick={onClick}>
      <div className={styles.header}>
        <span className={styles.name}>{project.name}</span>
        <StatusBadge status={project.status} />
      </div>
      <p className={styles.description}>{project.description}</p>
      <div className={styles.meta}>
        <span className={styles.stat}>{project.milestone_count} milestones</span>
        <span className={styles.stat}>{project.issue_count} issues</span>
      </div>
    </button>
  );
}
