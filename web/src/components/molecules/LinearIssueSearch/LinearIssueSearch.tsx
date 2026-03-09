import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import type { LinearIssue, LinearIssueStatus } from '@/models';
import { cn } from '@/utils';
import styles from './LinearIssueSearch.module.css';

export interface LinearIssueSearchProps {
  onSelect: (issue: LinearIssue) => void;
  onClear: () => void;
  selectedIssue: LinearIssue | null;
  onSearch: (query: string) => Promise<LinearIssue[]>;
  disabled?: boolean;
  className?: string;
}

const STATUS_LABELS: Record<LinearIssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

export function LinearIssueSearch({
  onSelect,
  onClear,
  selectedIssue,
  onSearch,
  disabled = false,
  className,
}: LinearIssueSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinearIssue[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const issues = await onSearch(searchQuery);
        setResults(issues);
      } finally {
        setSearching(false);
      }
    },
    [onSearch]
  );

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, performSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (issue: LinearIssue) => {
    onSelect(issue);
    setQuery('');
    setIsOpen(false);
    setResults([]);
  };

  const handleClear = () => {
    onClear();
    setQuery('');
    setResults([]);
  };

  if (selectedIssue) {
    return (
      <div className={cn(styles.selected, className)}>
        <div className={styles.selectedInfo}>
          <span className={styles.selectedIdentifier}>{selectedIssue.identifier}</span>
          <span className={styles.selectedTitle}>{selectedIssue.title}</span>
          <span className={styles.selectedStatus} data-status={selectedIssue.status}>
            {STATUS_LABELS[selectedIssue.status]}
          </span>
        </div>
        <button
          type="button"
          className={styles.clearButton}
          onClick={handleClear}
          disabled={disabled}
          aria-label="Clear selected issue"
        >
          <X className={styles.clearIcon} />
        </button>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)} ref={containerRef}>
      <div className={styles.inputWrapper}>
        <Search className={styles.searchIcon} />
        <input
          type="text"
          className={styles.input}
          placeholder="Search Linear issues (e.g. NIU-44)..."
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.length >= 2) {
              setIsOpen(true);
            }
          }}
          disabled={disabled}
        />
        {searching && <span className={styles.spinner} />}
      </div>

      {isOpen && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map(issue => (
            <button
              key={issue.id}
              type="button"
              className={styles.dropdownItem}
              onClick={() => handleSelect(issue)}
            >
              <div className={styles.itemHeader}>
                <span className={styles.itemIdentifier}>{issue.identifier}</span>
                <span className={styles.itemStatus} data-status={issue.status}>
                  {STATUS_LABELS[issue.status]}
                </span>
                {issue.priority !== undefined && issue.priority > 0 && (
                  <span className={styles.itemPriority} data-priority={issue.priority}>
                    {PRIORITY_LABELS[issue.priority]}
                  </span>
                )}
              </div>
              <span className={styles.itemTitle}>{issue.title}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.length >= 2 && results.length === 0 && !searching && (
        <div className={styles.dropdown}>
          <div className={styles.noResults}>No issues found</div>
        </div>
      )}
    </div>
  );
}
