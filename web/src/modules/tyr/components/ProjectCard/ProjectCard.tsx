import { cn } from '@/modules/shared/utils/classnames';
import type { TrackerProject } from '../../models';
import styles from './ProjectCard.module.css';

export interface ProjectCardProps {
  project: TrackerProject;
  imported?: boolean;
  onClick: () => void;
  className?: string;
}

export function ProjectCard({ project, imported, onClick, className }: ProjectCardProps) {
  return (
    <button
      type="button"
      className={cn(styles.card, imported && styles.imported, className)}
      onClick={onClick}
    >
      <div className={styles.header}>
        <span className={styles.name}>{project.name}</span>
        {imported && <span className={styles.importedBadge}>Imported</span>}
      </div>
      <p className={styles.description}>{project.description}</p>
      <div className={styles.meta}>
        <span className={styles.stat}>{project.milestone_count} milestones</span>
        <span className={styles.stat}>{project.issue_count} issues</span>
      </div>
    </button>
  );
}
