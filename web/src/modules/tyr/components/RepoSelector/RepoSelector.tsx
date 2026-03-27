import { useState, useRef, useEffect } from 'react';
import type { RepoInfo, SelectedRepo } from '../../models';
import styles from './RepoSelector.module.css';

interface BaseProps {
  repos: RepoInfo[];
  showBranch?: boolean;
}

interface MultiProps extends BaseProps {
  mode?: 'multi';
  selected: SelectedRepo[];
  onToggle: (repoId: string) => void;
  onBranchChange: (repoId: string, branch: string) => void;
  onSelect?: never;
  value?: never;
}

interface SingleProps extends BaseProps {
  mode: 'single';
  onSelect: (repoUrl: string) => void;
  value?: string;
  selected?: never;
  onToggle?: never;
  onBranchChange?: never;
}

type RepoSelectorProps = MultiProps | SingleProps;

export function RepoSelector(props: RepoSelectorProps) {
  const { repos, showBranch = true } = props;
  const mode = props.mode ?? 'multi';

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
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

  const selectedIds = mode === 'multi' ? props.selected.map(r => r.repoId) : [];
  const singleValue = mode === 'single' ? (props.value ?? '') : '';

  const selectedRepo =
    mode === 'single' && singleValue ? repos.find(r => r.url === singleValue) : null;

  const displayValue =
    mode === 'single' && !focused && selectedRepo
      ? `${selectedRepo.org}/${selectedRepo.name}`
      : search;

  const available = repos.filter(repo => {
    const repoId = repo.url;
    if (mode === 'multi' && selectedIds.includes(repoId)) {
      return false;
    }
    if (!search) {
      return true;
    }
    const term = search.toLowerCase();
    return (
      repoId.toLowerCase().includes(term) || `${repo.org}/${repo.name}`.toLowerCase().includes(term)
    );
  });

  if (repos.length === 0) {
    return <div className={styles.empty}>No repositories available</div>;
  }

  const placeholder =
    mode === 'single' ? 'Search and select a repository...' : 'Search and select repositories...';

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.dropdownWrapper}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={placeholder}
          value={displayValue}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
            if (mode === 'single' && selectedRepo) {
              setSearch('');
            }
          }}
          onBlur={() => {
            setFocused(false);
            if (mode === 'single') {
              setSearch('');
            }
          }}
        />
        {open && available.length > 0 && (
          <div className={styles.dropdown}>
            {available.map(repo => {
              const repoId = repo.url;
              return (
                <button
                  key={repoId}
                  type="button"
                  className={styles.dropdownItem}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    if (mode === 'single') {
                      props.onSelect(repoId);
                      setSearch('');
                      setOpen(false);
                    } else {
                      props.onToggle(repoId);
                      setSearch('');
                    }
                  }}
                >
                  <span className={styles.repoName}>
                    {repo.org}/{repo.name}
                  </span>
                  <span className={styles.providerBadge}>{repo.provider}</span>
                  {showBranch && <span className={styles.branch}>{repo.default_branch}</span>}
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

      {mode === 'multi' && props.selected.length > 0 && (
        <div className={styles.selectedList}>
          {props.selected.map(sel => {
            const repo = repos.find(r => r.url === sel.repoId);
            const branches = repo?.branches ?? [];
            const displayName = repo ? `${repo.org}/${repo.name}` : sel.repoId;
            return (
              <div key={sel.repoId} className={styles.selectedItem}>
                <span className={styles.repoName}>{displayName}</span>
                {showBranch && branches.length > 0 ? (
                  <select
                    className={styles.branchSelect}
                    value={sel.branch}
                    onChange={e => props.onBranchChange(sel.repoId, e.target.value)}
                  >
                    {branches.map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                ) : showBranch ? (
                  <span className={styles.branchLabel}>{sel.branch}</span>
                ) : null}
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => props.onToggle(sel.repoId)}
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
