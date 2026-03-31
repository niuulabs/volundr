import { StatusDot } from '@/modules/shared';
import type { ClusterInfo } from '../../hooks';
import styles from './DashboardTopBar.module.css';

interface DashboardTopBarProps {
  sagaCount: number;
  raidCount: number;
  clusterCount: number;
  connected: boolean;
  clusters: ClusterInfo[];
  selectedCluster: string;
  onClusterChange: (cluster: string) => void;
}

export function DashboardTopBar({
  sagaCount,
  raidCount,
  clusterCount,
  connected,
  clusters,
  selectedCluster,
  onClusterChange,
}: DashboardTopBarProps) {
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <h1 className={styles.title}>Dashboard</h1>
        <span className={styles.meta}>
          {sagaCount} saga{sagaCount !== 1 ? 's' : ''} &middot; {raidCount} raid
          {raidCount !== 1 ? 's' : ''} &middot; {clusterCount} cluster
          {clusterCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className={styles.right}>
        <span className={styles.live} data-connected={connected || undefined}>
          <StatusDot status={connected ? 'healthy' : 'failed'} pulse={connected} />
          {connected ? 'connected' : 'disconnected'}
        </span>
        <select
          className={styles.filter}
          value={selectedCluster}
          onChange={e => onClusterChange(e.target.value)}
        >
          <option value="">All Clusters</option>
          {clusters.map(c => (
            <option key={c.connection_id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
