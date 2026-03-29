import { useNavigate } from 'react-router-dom';
import { LoadingIndicator } from '@/modules/shared';
import { Download, Trash2 } from 'lucide-react';
import { useSagas } from '../../hooks';
import { BranchTag } from '../../components/BranchTag';
import styles from './SagasView.module.css';

export function SagasView() {
  const { sagas, loading, error, deleteSaga } = useSagas();
  const navigate = useNavigate();

  if (loading) {
    return <LoadingIndicator messages={['Loading sagas...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteSaga(id);
    } catch {
      // handled by hook
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.importAction}>
        <button
          type="button"
          className={styles.importButton}
          onClick={() => navigate('/tyr/import')}
        >
          <Download className={styles.importIcon} />
          Import from Tracker
        </button>
      </div>
      <div className={styles.list}>
        {sagas.map(saga => {
          const progressPercent = Math.round(saga.progress * 100);
          return (
            <button
              key={saga.id}
              type="button"
              className={styles.sagaCard}
              onClick={() => navigate(`/tyr/sagas/${saga.id}`)}
            >
              <div className={styles.sagaHeader}>
                <span className={styles.sagaName}>{saga.name}</span>
                <span className={styles.sagaStatus}>{saga.status}</span>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={e => handleDelete(e, saga.id)}
                  aria-label={`Delete ${saga.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className={styles.sagaMeta}>
                <span className={styles.repo}>{saga.repos.join(', ')}</span>
                <BranchTag source={saga.feature_branch} />
                <span className={styles.stat}>{saga.milestone_count} milestones</span>
                <span className={styles.stat}>{saga.issue_count} issues</span>
                {saga.url && (
                  <a
                    href={saga.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.trackerLink}
                    onClick={e => e.stopPropagation()}
                  >
                    Linear
                  </a>
                )}
              </div>
              <div className={styles.progressRow}>
                <span className={styles.progressTrack}>
                  <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
                </span>
                <span className={styles.progressLabel}>{progressPercent}%</span>
              </div>
            </button>
          );
        })}
        {sagas.length === 0 && <div className={styles.empty}>No sagas imported yet</div>}
      </div>
    </div>
  );
}
