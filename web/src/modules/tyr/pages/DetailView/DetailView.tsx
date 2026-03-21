import { useParams } from 'react-router-dom';
import { LoadingIndicator, StatusBadge } from '@/modules/shared';
import { useSagaDetail } from '../../hooks';
import { BranchTag } from '../../components/BranchTag';
import { ConfBar } from '../../components/ConfBar';
import { PhaseBlock } from '../../components/PhaseBlock';
import styles from './DetailView.module.css';

export function DetailView() {
  const { id } = useParams<{ id: string }>();
  const { saga, phases, loading, error } = useSagaDetail(id);

  if (loading) {
    return <LoadingIndicator messages={["Loading saga..."]} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!saga) {
    return <div className={styles.empty}>Saga not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={styles.sagaName}>{saga.name}</h2>
          <StatusBadge status={saga.status} />
        </div>
        <div className={styles.headerMeta}>
          <BranchTag source={saga.feature_branch} />
          <span className={styles.repo}>{saga.repo}</span>
          <span className={styles.trackerId}>{saga.tracker_id}</span>
        </div>
        <div className={styles.confBarWrapper}>
          <ConfBar value={saga.confidence} />
        </div>
      </div>
      <div className={styles.phaseList}>
        {phases.map(phase => (
          <PhaseBlock key={phase.id} phase={phase} />
        ))}
        {phases.length === 0 && <div className={styles.empty}>No phases defined</div>}
      </div>
    </div>
  );
}
