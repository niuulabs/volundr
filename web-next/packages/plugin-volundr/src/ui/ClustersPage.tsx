import { StateDot, Chip } from '@niuulabs/ui';
import type { Cluster, NodeStatus } from '../domain/cluster';
import { useClusters } from './useClusters';
import './ClustersPage.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(used: number, capacity: number): number {
  if (capacity === 0) return 0;
  return Math.round((used / capacity) * 100);
}

function nodeStatusState(status: NodeStatus): 'healthy' | 'observing' | 'failed' {
  if (status === 'ready') return 'healthy';
  if (status === 'cordoned') return 'observing';
  return 'failed';
}

function nodeStatusLabel(status: NodeStatus): string {
  if (status === 'ready') return 'ready';
  if (status === 'notready') return 'not ready';
  return 'cordoned';
}

interface CapacityBarProps {
  label: string;
  used: number;
  capacity: number;
  unit?: string;
}

function CapacityBar({ label, used, capacity, unit = '' }: CapacityBarProps) {
  const percentage = pct(used, capacity);
  const tone = percentage >= 90 ? 'critical' : percentage >= 70 ? 'warning' : 'ok';

  return (
    <div className="cluster-card__cap" data-testid={`cap-${label.toLowerCase()}`}>
      <div className="cluster-card__cap-header">
        <span className="cluster-card__cap-label">{label}</span>
        <span className="cluster-card__cap-value">
          {used}
          {unit} / {capacity}
          {unit}
        </span>
        <span className="cluster-card__cap-pct">{percentage}%</span>
      </div>
      <div className="cluster-card__cap-track">
        <div
          className="cluster-card__cap-fill"
          data-tone={tone}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} utilisation ${percentage}%`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClusterCard
// ---------------------------------------------------------------------------

interface ClusterCardProps {
  cluster: Cluster;
}

function ClusterCard({ cluster }: ClusterCardProps) {
  const readyCount = cluster.nodes.filter((n) => n.status === 'ready').length;
  const totalNodes = cluster.nodes.length;

  return (
    <article className="cluster-card" data-testid="cluster-card">
      <div className="cluster-card__header">
        <div className="cluster-card__title-row">
          <h3 className="cluster-card__name">{cluster.name}</h3>
          <Chip tone="muted">{cluster.realm}</Chip>
        </div>
        <div className="cluster-card__summary">
          <span className="cluster-card__stat">
            <strong>{cluster.runningSessions}</strong> running
          </span>
          {cluster.queuedProvisions > 0 && (
            <span className="cluster-card__stat cluster-card__stat--queued">
              <strong>{cluster.queuedProvisions}</strong> queued
            </span>
          )}
          <span className="cluster-card__stat">
            <strong>
              {readyCount}/{totalNodes}
            </strong>{' '}
            nodes ready
          </span>
        </div>
      </div>

      <div className="cluster-card__capacity">
        <CapacityBar label="CPU" used={cluster.used.cpu} capacity={cluster.capacity.cpu} />
        <CapacityBar
          label="Memory"
          used={cluster.used.memMi}
          capacity={cluster.capacity.memMi}
          unit=" Mi"
        />
        {cluster.capacity.gpu > 0 && (
          <CapacityBar label="GPU" used={cluster.used.gpu} capacity={cluster.capacity.gpu} />
        )}
      </div>

      <div className="cluster-card__nodes">
        <h4 className="cluster-card__nodes-title">Nodes</h4>
        <ul className="cluster-card__node-list" aria-label={`Nodes for ${cluster.name}`}>
          {cluster.nodes.map((node) => (
            <li key={node.id} className="cluster-card__node" data-testid="cluster-node">
              <StateDot state={nodeStatusState(node.status)} />
              <span className="cluster-card__node-id">{node.id}</span>
              <Chip tone="muted">{node.role}</Chip>
              <span className="cluster-card__node-status">{nodeStatusLabel(node.status)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// ClustersPage
// ---------------------------------------------------------------------------

export function ClustersPage() {
  const clusters = useClusters();

  return (
    <div className="clusters-page">
      <h2 className="clusters-page__title">Clusters</h2>

      <p className="clusters-page__subtitle">
        Infrastructure clusters available for session scheduling — capacity, utilisation, and node
        health.
      </p>

      {clusters.isLoading && (
        <div className="clusters-page__status">
          <StateDot state="processing" pulse />
          <span>loading clusters…</span>
        </div>
      )}

      {clusters.isError && (
        <div className="clusters-page__status">
          <StateDot state="failed" />
          <span>
            {clusters.error instanceof Error ? clusters.error.message : 'failed to load clusters'}
          </span>
        </div>
      )}

      {clusters.data && clusters.data.length === 0 && (
        <p className="clusters-page__empty">No clusters registered.</p>
      )}

      {clusters.data && clusters.data.length > 0 && (
        <ul className="clusters-page__list" aria-label="Clusters">
          {clusters.data.map((c) => (
            <li key={c.id}>
              <ClusterCard cluster={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
