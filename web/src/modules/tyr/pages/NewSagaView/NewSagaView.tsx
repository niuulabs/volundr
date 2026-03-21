import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Phase } from '../../models';
import { tyrService } from '../../adapters';
import { PhaseBlock } from '../../components/PhaseBlock';
import styles from './NewSagaView.module.css';

export function NewSagaView() {
  const [spec, setSpec] = useState('');
  const [repo, setRepo] = useState('');
  const [preview, setPreview] = useState<Phase[] | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const navigate = useNavigate();

  const handleDecompose = async () => {
    setDecomposing(true);
    try {
      const phases = await tyrService.decompose(spec, repo);
      setPreview(phases);
    } finally {
      setDecomposing(false);
    }
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const saga = await tyrService.createSaga(spec, repo);
      navigate(`/tyr/sagas/${saga.id}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Create New Saga</h2>
      <div className={styles.form}>
        <label className={styles.label} htmlFor="saga-spec">
          Specification
        </label>
        <textarea
          id="saga-spec"
          className={styles.textarea}
          value={spec}
          onChange={e => setSpec(e.target.value)}
          placeholder="Describe the feature to implement..."
          rows={8}
        />

        <label className={styles.label} htmlFor="saga-repo">
          Repository
        </label>
        <input
          id="saga-repo"
          type="text"
          className={styles.input}
          value={repo}
          onChange={e => setRepo(e.target.value)}
          placeholder="org/repo"
        />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.decomposeButton}
            onClick={handleDecompose}
            disabled={!spec.trim() || !repo.trim() || decomposing}
          >
            {decomposing ? 'Decomposing...' : 'Decompose'}
          </button>
        </div>
      </div>

      {preview !== null && (
        <div className={styles.preview}>
          <h3 className={styles.previewHeading}>Phase Preview</h3>
          {preview.map(phase => (
            <PhaseBlock key={phase.id} phase={phase} />
          ))}
          {preview.length === 0 && (
            <div className={styles.empty}>No phases generated. Try refining the specification.</div>
          )}
          {preview.length > 0 && (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.commitButton}
                onClick={handleCommit}
                disabled={committing}
              >
                {committing ? 'Creating...' : 'Commit'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
