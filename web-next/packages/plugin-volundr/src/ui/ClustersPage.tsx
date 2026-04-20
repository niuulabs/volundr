import { StateDot, LoadingState, ErrorState } from '@niuulabs/ui';
import type { Cluster, ClusterNode, NodeStatus } from '../domain/cluster';
import { useClusters } from './useClusters';
import { Meter, ClusterChip, MiniBar } from './atoms';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function pct(used: number, capacity: number): number {
  if (capacity === 0) return 0;
  return used / capacity;
}

// ---------------------------------------------------------------------------
// ResourcePanel — matches web2 ResourcePanel with Meter atom
// ---------------------------------------------------------------------------

interface ResourcePanelProps {
  label: string;
  used: number;
  total: number;
  unit?: string;
}

function ResourcePanel({ label, used, total, unit = '' }: ResourcePanelProps) {
  const ratio = pct(used, total);
  const pctNum = Math.round(ratio * 100);

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-gap-1 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
      data-testid={`resource-panel-${label.toLowerCase()}`}
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between">
        <span className="niuu-text-xs niuu-font-medium niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
          {label}
        </span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">{unit}</span>
      </div>
      <div className="niuu-font-mono niuu-text-lg niuu-font-semibold niuu-text-text-primary">
        {total === 0 ? (
          <span className="niuu-text-text-faint">&mdash;</span>
        ) : (
          <>
            {used}
            <span className="niuu-text-text-faint">/</span>
            {total}
          </>
        )}
      </div>
      <Meter used={used} limit={total} />
      <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
        {total === 0 ? 'not provisioned' : `${pctNum}% used`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeCard — a node tile with status dot + mini bars
// ---------------------------------------------------------------------------

function NodeCard({
  node,
  clusterId,
  cpuPct,
  memPct,
}: {
  node: ClusterNode;
  clusterId: string;
  cpuPct?: number;
  memPct?: number;
}) {
  const hasMiniMetrics = node.status === 'ready' && cpuPct != null && memPct != null;

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded niuu-border niuu-border-border-subtle niuu-bg-bg-primary niuu-p-3"
      data-testid="cluster-node"
    >
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-font-mono niuu-text-xs">
        <StateDot state={nodeStatusState(node.status)} />
        <span className="niuu-text-text-primary">
          {clusterId}-{node.id}
        </span>
        <span className="niuu-ml-auto niuu-text-text-faint">{node.role}</span>
      </div>
      {hasMiniMetrics ? (
        <div className="niuu-flex niuu-gap-2" data-testid="node-meters">
          <MiniBar value={cpuPct} label="cpu" />
          <MiniBar value={memPct} label="mem" />
        </div>
      ) : node.status === 'ready' ? (
        <div
          className="niuu-flex niuu-gap-2 niuu-font-mono niuu-text-[10px] niuu-text-text-faint"
          data-testid="node-meters"
        >
          <span>cpu —</span>
          <span>mem —</span>
        </div>
      ) : null}
      <span className="niuu-text-xs niuu-text-text-muted">{nodeStatusLabel(node.status)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClusterCard — full card matching web2 ClustersView
// ---------------------------------------------------------------------------

interface ClusterCardProps {
  cluster: Cluster;
}

function ClusterCard({ cluster }: ClusterCardProps) {
  const readyCount = cluster.nodes.filter((n) => n.status === 'ready').length;
  const totalNodes = cluster.nodes.length;

  return (
    <article
      className="niuu-flex niuu-flex-col niuu-gap-5 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-5"
      data-testid="cluster-card"
    >
      {/* Header */}
      <header className="niuu-flex niuu-flex-col niuu-gap-2">
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <ClusterChip cluster={{ name: cluster.name, kind: cluster.realm }} />
          <span
            className={`niuu-ml-auto niuu-rounded-full niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-font-medium ${
              readyCount === totalNodes
                ? 'niuu-bg-state-ok-bg niuu-text-state-ok'
                : 'niuu-bg-state-warn-bg niuu-text-state-warn'
            }`}
          >
            {readyCount === totalNodes ? 'healthy' : 'degraded'}
          </span>
        </div>
        <div className="niuu-flex niuu-flex-wrap niuu-gap-4 niuu-text-xs niuu-text-text-muted niuu-font-mono">
          <span>
            {readyCount}/{totalNodes} nodes ready
          </span>
          <span>
            <strong className="niuu-text-text-primary">{cluster.runningSessions}</strong> running
          </span>
          {cluster.queuedProvisions > 0 && (
            <span>
              <strong className="niuu-text-state-warn">{cluster.queuedProvisions}</strong> queued
            </span>
          )}
        </div>
      </header>

      {/* Resource meters */}
      <section
        className="niuu-grid niuu-grid-cols-2 niuu-gap-3 lg:niuu-grid-cols-4"
        aria-label="Resource utilization"
        data-testid="resource-meters"
      >
        <ResourcePanel
          label="CPU"
          used={cluster.used.cpu}
          total={cluster.capacity.cpu}
          unit="cores"
        />
        <ResourcePanel
          label="Memory"
          used={cluster.used.memMi}
          total={cluster.capacity.memMi}
          unit="Mi"
        />
        <ResourcePanel
          label="GPU"
          used={cluster.used.gpu}
          total={cluster.capacity.gpu}
          unit="gpu"
        />
        <ResourcePanel
          label="Pods"
          used={cluster.runningSessions}
          total={cluster.runningSessions + cluster.queuedProvisions + 10}
          unit="slots"
        />
      </section>

      {/* Two-column grid: pods + nodes */}
      <div className="niuu-grid niuu-gap-4 lg:niuu-grid-cols-2">
        {/* Pods panel */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-primary niuu-p-4"
          aria-label={`Pods on ${cluster.name}`}
          data-testid="pods-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
              Pods on this forge
            </h3>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {cluster.runningSessions}
            </span>
          </div>
          {cluster.runningSessions === 0 ? (
            <p className="niuu-font-mono niuu-text-xs niuu-text-text-muted" data-testid="no-pods">
              no active pods
            </p>
          ) : (
            <ul className="niuu-flex niuu-flex-col niuu-gap-1" aria-label="Pod list">
              {Array.from({ length: cluster.runningSessions }).map((_, i) => (
                <li
                  key={i}
                  className="niuu-flex niuu-items-center niuu-gap-2 niuu-rounded niuu-px-2 niuu-py-1.5 hover:niuu-bg-bg-tertiary"
                  data-testid="pod-row"
                >
                  <StateDot state="running" pulse />
                  <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary">
                    {cluster.id}-pod-{i + 1}
                  </span>
                  <span className="niuu-ml-auto niuu-font-mono niuu-text-xs niuu-text-text-faint">
                    active
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Nodes grid */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-primary niuu-p-4"
          aria-label={`Nodes for ${cluster.name}`}
          data-testid="nodes-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Nodes</h3>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {readyCount}/{totalNodes}
            </span>
          </div>
          <div
            className="niuu-grid niuu-grid-cols-1 niuu-gap-2 sm:niuu-grid-cols-2"
            data-testid="nodes-grid"
          >
            {cluster.nodes.map((node) => (
              <NodeCard key={node.id} node={node} clusterId={cluster.id} />
            ))}
          </div>
        </section>
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
    <div className="niuu-flex niuu-flex-col niuu-gap-6 niuu-p-6" data-testid="clusters-page">
      {/* Header */}
      <div>
        <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">Clusters</h2>
        <p className="niuu-text-sm niuu-text-text-muted">
          Infrastructure clusters available for session scheduling — capacity, utilisation, and node
          health.
        </p>
      </div>

      {/* Loading */}
      {clusters.isLoading && <LoadingState label="Loading clusters…" />}

      {/* Error */}
      {clusters.isError && (
        <ErrorState
          title="Failed to load clusters"
          message={
            clusters.error instanceof Error ? clusters.error.message : 'Failed to load clusters'
          }
        />
      )}

      {/* Empty */}
      {clusters.data && clusters.data.length === 0 && (
        <p className="niuu-text-sm niuu-text-text-muted" data-testid="no-clusters">
          No clusters registered.
        </p>
      )}

      {/* Cluster cards */}
      {clusters.data && clusters.data.length > 0 && (
        <ul
          className="niuu-flex niuu-flex-col niuu-gap-5 niuu-list-none niuu-p-0"
          aria-label="Clusters"
        >
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
