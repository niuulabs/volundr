import type { RepoInfo } from '../../models';
import styles from './RepoSelector.module.css';

interface RepoSelectorProps {
  repos: RepoInfo[];
  selected: string[];
  onToggle: (repoId: string) => void;
}

export function RepoSelector({ repos, selected, onToggle }: RepoSelectorProps) {
  if (repos.length === 0) {
    return <div className={styles.empty}>No repositories available</div>;
  }

  return (
    <div className={styles.container}>
      {repos.map(repo => {
        const repoId = `${repo.org}/${repo.name}`;
        const isSelected = selected.includes(repoId);
        return (
          <button
            key={repoId}
            type="button"
            className={isSelected ? styles.itemSelected : styles.item}
            onClick={() => onToggle(repoId)}
          >
            <span className={styles.checkbox}>{isSelected ? '\u2611' : '\u2610'}</span>
            <span className={styles.repoName}>
              {repo.org}/{repo.name}
            </span>
            <span className={styles.providerBadge}>{repo.provider}</span>
            <span className={styles.branch}>{repo.default_branch}</span>
          </button>
        );
      })}
    </div>
  );
}
