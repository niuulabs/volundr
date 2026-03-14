import { useState, useCallback, useRef, useEffect } from 'react';
import type { TrackerIssue } from '@/hooks/useIssues';
import { useIssues } from '@/hooks/useIssues';
import styles from './IssuePicker.module.css';

interface IssuePickerProps {
  onSelect: (issue: TrackerIssue) => void;
  onClear?: () => void;
  selectedIssue?: TrackerIssue | null;
}

export function IssuePicker({ onSelect, onClear, selectedIssue }: IssuePickerProps) {
  const { issues, loading, searchIssues } = useIssues();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (value.length >= 2) {
        debounceRef.current = setTimeout(() => {
          searchIssues(value);
          setOpen(true);
        }, 300);
      } else {
        setOpen(false);
      }
    },
    [searchIssues]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSelect = useCallback(
    (issue: TrackerIssue) => {
      onSelect(issue);
      setQuery('');
      setOpen(false);
    },
    [onSelect]
  );

  if (selectedIssue) {
    return (
      <div className={styles.selected}>
        <span className={styles.selectedIdentifier}>{selectedIssue.identifier}</span>
        <span className={styles.selectedTitle}>{selectedIssue.title}</span>
        {onClear && (
          <button className={styles.clearButton} onClick={onClear} type="button">
            &times;
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <input
        className={styles.input}
        type="text"
        placeholder="Search issues..."
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => {
          if (issues.length > 0 && query.length >= 2) {
            setOpen(true);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && (
        <div className={styles.dropdown}>
          {loading ? (
            <div className={styles.dropdownItem}>Searching...</div>
          ) : issues.length === 0 ? (
            <div className={styles.dropdownItem}>No issues found</div>
          ) : (
            issues.map(issue => (
              <button
                key={issue.id}
                className={styles.dropdownItem}
                onClick={() => handleSelect(issue)}
                type="button"
              >
                <span className={styles.issueIdentifier}>{issue.identifier}</span>
                <span className={styles.issueTitle}>{issue.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
