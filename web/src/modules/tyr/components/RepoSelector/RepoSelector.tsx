import { useState, useRef, useEffect } from 'react';
import type { RepoInfo, SelectedRepo } from '../../models';
import styles from './RepoSelector.module.css';

interface RepoSelectorProps {
  repos: RepoInfo[];
  selected: SelectedRepo[];
  onToggle: (repoId: string) => void;
  onBranchChange: (repoId: string, branch: string) => void;
}

export function RepoSelector({ repos, selected, onToggle, onBranchChange }: RepoSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const selectedIds = selected.map(r => r.repoId);

  const available = repos.filter(repo => {
    const repoId = `${repo.org}/${repo.name}`;
    if (selectedIds.includes(repoId)) {
      return false;
    }
    if (!search) {
      return true;
    }
    return repoId.toLowerCase().includes(search.toLowerCase());
  });

  if (repos.length === 0) {
    return <div className={styles.empty}>No repositories available</div>;
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.dropdownWrapper}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search and select repositories..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {open && available.length > 0 && (
          <div className={styles.dropdown}>
            {available.map(repo => {
              const repoId = `${repo.org}/${repo.name}`;
              return (
                <button
                  key={repoId}
                  type="button"
                  className={styles.dropdownItem}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    onToggle(repoId);
                    setSearch('');
                  }}
                >
                  <span className={styles.repoName}>
                    {repo.org}/{repo.name}
                  </span>
                  <span className={styles.providerBadge}>{repo.provider}</span>
                  <span className={styles.branch}>{repo.default_branch}</span>
                </button>
              );
            })}
          </div>
        )}
        {open && available.length === 0 && search && (
          <div className={styles.dropdown}>
            <div className={styles.noResults}>No matching repositories</div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className={styles.selectedList}>
          {selected.map(sel => {
            const repo = repos.find(r => `${r.org}/${r.name}` === sel.repoId);
            const branches = repo?.branches ?? [];
            return (
              <div key={sel.repoId} className={styles.selectedItem}>
                <span className={styles.repoName}>{sel.repoId}</span>
                {branches.length > 0 ? (
                  <select
                    className={styles.branchSelect}
                    value={sel.branch}
                    onChange={e => onBranchChange(sel.repoId, e.target.value)}
                  >
                    {branches.map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={styles.branchLabel}>{sel.branch}</span>
                )}
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => onToggle(sel.repoId)}
                  aria-label={`Remove ${sel.repoId}`}
                >
                  {'\u2715'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
