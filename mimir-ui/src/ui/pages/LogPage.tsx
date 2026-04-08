import { useState, useEffect, useCallback } from 'react';
import type { MimirLogEntry } from '@/domain';
import { useActivePorts } from '@/contexts/PortsContext';
import { LogViewer } from '@/ui/components/LogViewer/LogViewer';
import styles from './LogPage.module.css';

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const LINE_COUNT_OPTIONS = [50, 100, 200, 500] as const;
type LineCount = (typeof LINE_COUNT_OPTIONS)[number];

export function LogPage() {
  const { api } = useActivePorts();

  const [logEntry, setLogEntry] = useState<MimirLogEntry | null>(null);
  const [lineCount, setLineCount] = useState<LineCount>(100);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entry = await api.getLog(lineCount);
      setLogEntry(entry);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load log');
    } finally {
      setLoading(false);
    }
  }, [api, lineCount]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchLog();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [fetchLog]);

  function handleLineCountChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setLineCount(Number(event.target.value) as LineCount);
  }

  const metaText = lastRefreshed
    ? `Last refreshed ${lastRefreshed.toLocaleTimeString()} · auto-refresh every 30s`
    : 'Loading…';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.heading}>Log</h1>
          <p className={styles.meta}>{metaText}</p>
        </div>
        <div className={styles.headerControls}>
          <select
            className={styles.lineCountSelect}
            value={lineCount}
            onChange={handleLineCountChange}
            aria-label="Number of log lines"
          >
            {LINE_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} lines
              </option>
            ))}
          </select>
          <button
            className={styles.refreshButton}
            onClick={fetchLog}
            disabled={loading}
            type="button"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {!error && !logEntry && loading && (
        <div className={styles.loading}>Loading log…</div>
      )}
      {logEntry && (
        <div className={styles.content}>
          <LogViewer
            entries={logEntry.entries}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>
      )}
    </div>
  );
}
