import { useNavigate } from 'react-router-dom';
import type { SagaListItem } from '../../hooks';
import styles from './SagasSidebar.module.css';

interface SagasSidebarProps {
  sagas: SagaListItem[];
}

export function SagasSidebar({ sagas }: SagasSidebarProps) {
  const navigate = useNavigate();

  if (sagas.length === 0) {
    return <div className={styles.empty}>No sagas</div>;
  }

  return (
    <div className={styles.list}>
      {sagas.map(saga => {
        const pct = Math.round(saga.progress * 100);
        const total = saga.issue_count || 0;
        const done = Math.round(saga.progress * total);

        return (
          <div
            key={saga.id}
            className={styles.saga}
            onClick={() => navigate(`/tyr/sagas/${saga.id}`)}
          >
            <div className={styles.info}>
              <div className={styles.name}>{saga.name}</div>
              <div className={styles.meta}>
                {saga.milestone_count} phase{saga.milestone_count !== 1 ? 's' : ''}
                {' \u00b7 '}
                {total} raid{total !== 1 ? 's' : ''}
                {' \u00b7 '}
                <span className={styles.status} data-status={saga.status}>
                  {saga.status}
                </span>
              </div>
            </div>
            <div className={styles.progressRow}>
              <div className={styles.bar}>
                <div className={styles.fill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.progressLabel}>{pct}%</span>
            </div>
            <div className={styles.count}>
              {done}/{total}
            </div>
          </div>
        );
      })}
    </div>
  );
}
