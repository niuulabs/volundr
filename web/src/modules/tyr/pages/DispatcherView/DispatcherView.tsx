import { useState } from 'react';
import { LoadingIndicator } from '@/modules/shared';
import { useDispatchQueue } from '../../hooks/useDispatchQueue';
import type { QueueItem } from '../../hooks/useDispatchQueue';
import styles from './DispatcherView.module.css';

export function DispatcherView() {
  const { queue, defaults, loading, error, dispatching, dispatch } = useDispatchQueue();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<
    { issue_id: string; session_name: string; status: string; cluster_name: string }[] | null
  >(null);

  const toggleItem = (issueId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(queue.map(q => q.issue_id)));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const handleDispatch = async () => {
    const items = queue
      .filter(q => selected.has(q.issue_id))
      .map(q => ({
        saga_id: q.saga_id,
        issue_id: q.issue_id,
        repo: q.repos[0] || '',
      }));

    if (items.length === 0) {
      return;
    }

    const results = await dispatch(
      items,
      modelOverride ?? defaults.default_model,
      promptOverride ?? defaults.default_system_prompt
    );
    setLastResults(results);
    setSelected(new Set());
  };

  if (loading) {
    return <LoadingIndicator messages={['Loading dispatch queue...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  // Group by saga
  const bySaga: Record<string, { sagaName: string; items: QueueItem[] }> = {};
  for (const item of queue) {
    if (!bySaga[item.saga_id]) {
      bySaga[item.saga_id] = { sagaName: item.saga_name, items: [] };
    }
    bySaga[item.saga_id].items.push(item);
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Dispatch Queue</h2>
        <span className={styles.queueCount}>{queue.length} ready</span>
      </div>

      {lastResults && (
        <div className={styles.results}>
          {lastResults.map(r => (
            <div
              key={r.issue_id}
              className={r.status === 'spawned' ? styles.resultSuccess : styles.resultFailed}
            >
              {r.status === 'spawned' ? '\u2713' : '\u2717'} {r.session_name || r.issue_id} —{' '}
              {r.status}
              {r.cluster_name && (
                <span className={styles.clusterBadge}>{r.cluster_name}</span>
              )}
            </div>
          ))}
          <button
            type="button"
            className={styles.dismissButton}
            onClick={() => setLastResults(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <div className={styles.controls}>
          <div className={styles.selectionControls}>
            <button type="button" className={styles.selectButton} onClick={selectAll}>
              Select All
            </button>
            <button type="button" className={styles.selectButton} onClick={clearSelection}>
              Clear
            </button>
            <span className={styles.selectedCount}>{selected.size} selected</span>
          </div>
          <div className={styles.dispatchControls}>
            <select
              className={styles.modelSelect}
              value={modelOverride ?? defaults.default_model}
              onChange={e => setModelOverride(e.target.value)}
            >
              {defaults.models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.dispatchButton}
              onClick={handleDispatch}
              disabled={selected.size === 0 || dispatching}
            >
              {dispatching ? 'Dispatching...' : `Dispatch ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {Object.entries(bySaga).map(([sagaId, { sagaName, items }]) => (
        <div key={sagaId} className={styles.sagaGroup}>
          <div className={styles.sagaHeader}>{sagaName}</div>
          {items.map(item => (
            <label key={item.issue_id} className={styles.queueItem}>
              <input
                type="checkbox"
                checked={selected.has(item.issue_id)}
                onChange={() => toggleItem(item.issue_id)}
                className={styles.checkbox}
              />
              <span className={styles.itemIdentifier}>{item.identifier}</span>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.itemPhase}>{item.phase_name}</span>
              {item.priority_label && (
                <span className={styles.itemPriority}>{item.priority_label}</span>
              )}
              {item.estimate != null && (
                <span className={styles.itemEstimate}>{item.estimate}pt</span>
              )}
            </label>
          ))}
        </div>
      ))}

      {queue.length === 0 && <div className={styles.empty}>No issues ready for dispatch</div>}

      {queue.length > 0 && (
        <div className={styles.promptSection}>
          <label className={styles.promptLabel}>System Prompt (optional)</label>
          <textarea
            className={styles.promptTextarea}
            value={promptOverride ?? defaults.default_system_prompt}
            onChange={e => setPromptOverride(e.target.value)}
            placeholder="Additional instructions for all dispatched sessions..."
            rows={3}
          />
        </div>
      )}
    </div>
  );
}
