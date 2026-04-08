import { useMemo } from 'react';
import styles from './LogViewer.module.css';

const OPERATION_KEYWORDS = [
  'ingest',
  'update',
  'delete',
  'create',
  'search',
  'lint',
  'error',
  'warning',
  'info',
] as const;

type OperationKeyword = (typeof OPERATION_KEYWORDS)[number];

function classifyEntry(entry: string): OperationKeyword | null {
  const lower = entry.toLowerCase();
  for (const kw of OPERATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return kw;
    }
  }
  return null;
}

interface LogViewerProps {
  entries: string[];
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
}

export function LogViewer({ entries, filter, onFilterChange }: LogViewerProps) {
  const filtered = useMemo(() => {
    if (!filter) {
      return entries;
    }
    const lower = filter.toLowerCase();
    return entries.filter((e) => e.toLowerCase().includes(lower));
  }, [entries, filter]);

  const handleFilterClick = (kw: string) => {
    if (filter === kw) {
      onFilterChange(null);
      return;
    }
    onFilterChange(kw);
  };

  const handleClear = () => {
    onFilterChange(null);
  };

  return (
    <div className={styles.logViewer}>
      <div className={styles.toolbar}>
        <div className={styles.filterChips}>
          {OPERATION_KEYWORDS.map((kw) => (
            <button
              key={kw}
              className={styles.chip}
              data-active={filter === kw}
              data-kw={kw}
              onClick={() => handleFilterClick(kw)}
            >
              {kw}
            </button>
          ))}
        </div>
        {filter && (
          <button className={styles.clearButton} onClick={handleClear} aria-label="Clear filter">
            Clear
          </button>
        )}
        <span className={styles.count}>
          {filtered.length} / {entries.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyText}>
            {entries.length === 0 ? 'No log entries' : 'No entries match the current filter'}
          </span>
        </div>
      ) : (
        <ol className={styles.entryList} reversed>
          {[...filtered].reverse().map((entry, i) => {
            const kw = classifyEntry(entry);
            return (
              <li key={i} className={styles.entry} data-kw={kw ?? 'none'}>
                <span className={styles.entryText}>{entry}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
