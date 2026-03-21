import { LoadingIndicator } from '@/modules/shared';
import { useDispatcher } from '../../hooks';
import styles from './DispatcherView.module.css';

export function DispatcherView() {
  const { state, log, loading, error, pause, resume, setThreshold } = useDispatcher();

  if (loading) {
    return <LoadingIndicator label="Loading dispatcher..." />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!state) {
    return <div className={styles.empty}>Dispatcher not available</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.statusStrip} data-running={state.running}>
        <span className={styles.statusLabel}>
          {state.running ? 'Running' : 'Paused'}
        </span>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => (state.running ? pause() : resume())}
        >
          {state.running ? 'Pause' : 'Resume'}
        </button>
      </div>

      <div className={styles.controls}>
        <label className={styles.thresholdLabel} htmlFor="threshold-range">
          Confidence Threshold: {Math.round(state.threshold * 100)}%
        </label>
        <input
          id="threshold-range"
          type="range"
          className={styles.thresholdRange}
          min={0}
          max={100}
          value={Math.round(state.threshold * 100)}
          onChange={(e) => setThreshold(Number(e.target.value) / 100)}
        />
      </div>

      <div className={styles.logArea}>
        <h3 className={styles.logHeading}>Dispatcher Log</h3>
        <div className={styles.logScroll}>
          {log.map((line, i) => (
            <div key={i} className={styles.logLine}>
              {line}
            </div>
          ))}
          {log.length === 0 && (
            <div className={styles.logEmpty}>No log entries</div>
          )}
        </div>
      </div>
    </div>
  );
}
