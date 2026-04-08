import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MimirLintReport } from '../api/types';
import * as mimirClient from '../api/client';
import { LintPanel } from '../components/LintPanel/LintPanel';
import styles from './LintView.module.css';

export function LintView() {
  const navigate = useNavigate();

  const [report, setReport] = useState<MimirLintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLint = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await mimirClient.getLint();
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lint report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLint();
  }, [fetchLint]);

  function handlePageClick(path: string) {
    navigate(`../browse?path=${encodeURIComponent(path)}`);
  }

  const subheadingText = report
    ? `${report.pagesChecked} pages checked -- ${report.issuesFound ? 'issues found' : 'all clear'}`
    : 'Checking knowledge health...';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.heading}>Health Report</h1>
          <p className={styles.subheading}>{subheadingText}</p>
        </div>
        <button
          className={styles.refreshButton}
          onClick={fetchLint}
          disabled={loading}
          type="button"
        >
          {loading ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {!error && !report && loading && (
        <div className={styles.loading}>Running health checks...</div>
      )}
      {report && (
        <div className={styles.content}>
          <LintPanel report={report} onPageClick={handlePageClick} />
        </div>
      )}
    </div>
  );
}
