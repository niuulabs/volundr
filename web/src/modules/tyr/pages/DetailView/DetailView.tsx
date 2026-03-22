import { useParams } from 'react-router-dom';
import { LoadingIndicator } from '@/modules/shared';
import { useSagaDetail } from '../../hooks';
import type { SagaPhase, SagaRaid } from '../../hooks/useSagaDetail';
import { BranchTag } from '../../components/BranchTag';
import styles from './DetailView.module.css';

function RaidRow({ raid }: { raid: SagaRaid }) {
  const statusColor =
    raid.status_type === 'completed'
      ? 'var(--color-accent-emerald)'
      : raid.status_type === 'started'
        ? 'var(--color-accent-cyan)'
        : raid.status_type === 'cancelled'
          ? 'var(--color-accent-red)'
          : 'var(--color-text-muted)';

  return (
    <a href={raid.url} target="_blank" rel="noopener noreferrer" className={styles.raidRow}>
      <span className={styles.raidIdentifier}>{raid.identifier}</span>
      <span className={styles.raidTitle}>{raid.title}</span>
      <span className={styles.raidStatus} style={{ color: statusColor }}>
        {raid.status}
      </span>
      {raid.priority_label && <span className={styles.raidPriority}>{raid.priority_label}</span>}
      {raid.estimate != null && <span className={styles.raidEstimate}>{raid.estimate}pt</span>}
      {raid.assignee && <span className={styles.raidAssignee}>{raid.assignee}</span>}
    </a>
  );
}

function PhaseBlock({ phase }: { phase: SagaPhase }) {
  const progressPercent = Math.round(phase.progress * 100);

  return (
    <div className={styles.phaseBlock}>
      <div className={styles.phaseHeader}>
        <span className={styles.phaseName}>{phase.name}</span>
        <span className={styles.phaseProgress}>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </span>
          <span className={styles.progressLabel}>{progressPercent}%</span>
        </span>
        <span className={styles.phaseRaidCount}>{phase.raids.length} issues</span>
      </div>
      {phase.description && <p className={styles.phaseDescription}>{phase.description}</p>}
      <div className={styles.raidList}>
        {phase.raids.map(raid => (
          <RaidRow key={raid.id} raid={raid} />
        ))}
        {phase.raids.length === 0 && <div className={styles.phaseEmpty}>No issues</div>}
      </div>
    </div>
  );
}

export function DetailView() {
  const { id } = useParams<{ id: string }>();
  const { detail, loading, error } = useSagaDetail(id);

  if (loading) {
    return <LoadingIndicator messages={['Loading saga...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!detail) {
    return <div className={styles.empty}>Saga not found</div>;
  }

  const progressPercent = Math.round(detail.progress * 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={styles.sagaName}>{detail.name}</h2>
          <span className={styles.sagaStatus}>{detail.status}</span>
        </div>
        {detail.description && <p className={styles.sagaDescription}>{detail.description}</p>}
        <div className={styles.headerMeta}>
          <BranchTag source={detail.feature_branch} />
          <span className={styles.repo}>{detail.repos.join(', ')}</span>
          {detail.url && (
            <a
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.trackerLink}
            >
              Linear
            </a>
          )}
        </div>
        <div className={styles.sagaProgress}>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </span>
          <span className={styles.progressLabel}>{progressPercent}%</span>
        </div>
      </div>
      <div className={styles.phaseList}>
        {detail.phases.map(phase => (
          <PhaseBlock key={phase.id} phase={phase} />
        ))}
        {detail.phases.length === 0 && <div className={styles.empty}>No phases</div>}
      </div>
    </div>
  );
}
