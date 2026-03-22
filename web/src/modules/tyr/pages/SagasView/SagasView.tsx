import { useNavigate } from 'react-router-dom';
import { MetricCard, StatusBadge, LoadingIndicator } from '@/modules/shared';
import { BarChart3, Zap, TrendingUp, Download } from 'lucide-react';
import { useSagas } from '../../hooks';
import { ConfBadge } from '../../components/ConfBadge';
import { BranchTag } from '../../components/BranchTag';
import styles from './SagasView.module.css';

export function SagasView() {
  const { sagas, loading, error } = useSagas();
  const navigate = useNavigate();

  if (loading) {
    return <LoadingIndicator messages={['Loading sagas...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const activeSagas = sagas.filter(s => s.status === 'active');
  const avgConfidence =
    sagas.length > 0 ? sagas.reduce((sum, s) => sum + s.confidence, 0) / sagas.length : 0;

  return (
    <div className={styles.container}>
      <div className={styles.stats}>
        <MetricCard label="Total Sagas" value={sagas.length} icon={BarChart3} iconColor="cyan" />
        <MetricCard label="Active" value={activeSagas.length} icon={Zap} iconColor="emerald" />
        <MetricCard
          label="Avg Confidence"
          value={`${Math.round(avgConfidence * 100)}%`}
          icon={TrendingUp}
          iconColor="amber"
        />
      </div>
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
        {sagas.map(saga => (
          <button
            key={saga.id}
            type="button"
            className={styles.sagaCard}
            onClick={() => navigate(`/tyr/sagas/${saga.id}`)}
          >
            <div className={styles.sagaHeader}>
              <span className={styles.sagaName}>{saga.name}</span>
              <StatusBadge status={saga.status} />
            </div>
            <div className={styles.sagaMeta}>
              <span className={styles.trackerId}>{saga.tracker_id}</span>
              <span className={styles.repo}>{saga.repo}</span>
              <BranchTag source={saga.feature_branch} />
              <ConfBadge value={saga.confidence} />
            </div>
            <div className={styles.phaseProgress}>
              <div className={styles.phaseTrack}>
                <div
                  className={styles.phaseFill}
                  style={{
                    width:
                      saga.phase_summary.total > 0
                        ? `${(saga.phase_summary.completed / saga.phase_summary.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
              <span className={styles.phaseLabel}>
                {saga.phase_summary.completed}/{saga.phase_summary.total} phases
              </span>
            </div>
          </button>
        ))}
        {sagas.length === 0 && <div className={styles.empty}>No sagas found</div>}
      </div>
    </div>
  );
}
