import { useState, useEffect } from 'react';
import { cn } from '@/modules/shared/utils/classnames';
import { useCalibration } from '../../hooks/useCalibration';
import styles from './CalibrationView.module.css';

const WINDOW_OPTIONS = [7, 30, 90] as const;

function divergenceBand(rate: number): 'green' | 'amber' | 'red' {
  if (rate < 0.05) return 'green';
  if (rate <= 0.15) return 'amber';
  return 'red';
}

export function CalibrationView() {
  const {
    data,
    loading,
    error,
    windowDays,
    setWindowDays,
    reviewerPrompt,
    promptLoading,
    savingPrompt,
    loadPrompt,
    savePrompt,
  } = useCalibration();

  const [promptOpen, setPromptOpen] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');

  useEffect(() => {
    setEditedPrompt(reviewerPrompt);
  }, [reviewerPrompt]);

  const handleTogglePrompt = () => {
    if (!promptOpen && !reviewerPrompt) {
      loadPrompt();
    }
    setPromptOpen(prev => !prev);
  };

  const handleSave = async () => {
    await savePrompt(editedPrompt);
  };

  if (error) {
    return <div className={styles.page}><p className={styles.error}>{error}</p></div>;
  }

  if (loading) {
    return <div className={styles.page}><p className={styles.loading}>Loading calibration data…</p></div>;
  }

  if (!data || data.total_decisions === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Reviewer Calibration</h1>
        <div className={styles.empty}>No reviewer decisions recorded yet</div>
      </div>
    );
  }

  const band = divergenceBand(data.divergence_rate);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Reviewer Calibration</h1>

      {/* Window selector */}
      <div className={styles.windowSelector}>
        {WINDOW_OPTIONS.map(days => (
          <button
            key={days}
            type="button"
            className={cn(styles.windowBtn, windowDays === days && styles.windowBtnActive)}
            onClick={() => setWindowDays(days)}
          >
            {days}d
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{data.total_decisions}</div>
          <div className={styles.statLabel}>Total Decisions</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{data.auto_approved}</div>
          <div className={styles.statLabel}>Auto-Approved</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{data.retried}</div>
          <div className={styles.statLabel}>Retried</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{data.escalated}</div>
          <div className={styles.statLabel}>Escalated</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{data.pending_resolution}</div>
          <div className={styles.statLabel}>Pending Resolution</div>
        </div>
      </div>

      {/* Divergence rate badge */}
      <div className={styles.section}>
        <h2 className={styles.subheading}>Divergence Rate</h2>
        <span className={styles.badge} data-band={band}>
          {(data.divergence_rate * 100).toFixed(1)}%
        </span>
      </div>

      {/* Confidence delta */}
      <div className={styles.section}>
        <h2 className={styles.subheading}>Confidence Delta</h2>
        <p className={styles.confidenceText}>
          Avg confidence: approved{' '}
          <strong>{data.avg_confidence_approved.toFixed(2)}</strong> vs reverted{' '}
          <strong>{data.avg_confidence_reverted.toFixed(2)}</strong>
        </p>
      </div>

      {/* Reviewer prompt editor */}
      <div className={styles.section}>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={handleTogglePrompt}
        >
          {promptOpen ? '▾' : '▸'} Reviewer Prompt Editor
        </button>
        {promptOpen && (
          <div className={styles.promptEditor}>
            {promptLoading ? (
              <p className={styles.loading}>Loading prompt…</p>
            ) : (
              <>
                <textarea
                  className={styles.promptTextarea}
                  value={editedPrompt}
                  onChange={e => setEditedPrompt(e.target.value)}
                  rows={16}
                />
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={savingPrompt || editedPrompt === reviewerPrompt}
                >
                  {savingPrompt ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
