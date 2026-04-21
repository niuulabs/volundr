import { useMemo, useState } from 'react';
import { cn, ErrorState, LoadingState, Meter, relTime, StateDot } from '@niuulabs/ui';
import type {
  Cluster,
  ClusterNode,
  ClusterPod,
  ClusterDisk,
  ClusterKind,
  ClusterStatus,
  NodeStatus,
  PodStatus,
} from '../domain/cluster';
import { useClusters } from './useClusters';
import { MiniBar } from './atoms';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISK_SEGMENT_COLORS = {
  system: 'niuu-bg-brand',
  pods: 'niuu-bg-state-warn',
  logs: 'niuu-bg-state-ok',
} as const;

type SortField = 'name' | 'status' | 'age' | 'cpu' | 'memory' | 'restarts';
type SortDir = 'asc' | 'desc';

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

function podStatusState(
  status: PodStatus,
): 'running' | 'idle' | 'observing' | 'failed' | 'healthy' {
  if (status === 'running') return 'running';
  if (status === 'idle') return 'idle';
  if (status === 'pending') return 'observing';
  if (status === 'failed') return 'failed';
  return 'healthy';
}

function clusterStatusState(status: ClusterStatus): 'healthy' | 'attention' | 'failed' {
  if (status === 'healthy') return 'healthy';
  if (status === 'warning') return 'attention';
  return 'failed';
}

function kindLabel(kind: ClusterKind): string {
  return kind;
}

function pct(used: number, capacity: number): number {
  if (capacity === 0) return 0;
  return used / capacity;
}

function comparePods(a: ClusterPod, b: ClusterPod, field: SortField, dir: SortDir): number {
  let cmp = 0;
  if (field === 'name') cmp = a.name.localeCompare(b.name);
  else if (field === 'status') cmp = a.status.localeCompare(b.status);
  else if (field === 'age') cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  else if (field === 'cpu') cmp = a.cpuUsed / a.cpuLimit - b.cpuUsed / b.cpuLimit;
  else if (field === 'memory') cmp = a.memUsedMi / a.memLimitMi - b.memUsedMi / b.memLimitMi;
  else if (field === 'restarts') cmp = a.restarts - b.restarts;
  return dir === 'asc' ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// ClusterDetailHeader
// ---------------------------------------------------------------------------

interface ClusterDetailHeaderProps {
  cluster: Cluster;
}

function ClusterDetailHeader({ cluster }: ClusterDetailHeaderProps) {
  const readyCount = cluster.nodes.filter((n) => n.status === 'ready').length;
  const totalNodes = cluster.nodes.length;

  return (
    <header className="niuu-flex niuu-flex-col niuu-gap-3" data-testid="cluster-detail-header">
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-flex-wrap niuu-gap-3">
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-wrap">
          <span
            className={cn(
              'niuu-rounded niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-font-medium niuu-uppercase',
              cluster.kind === 'gpu'
                ? 'niuu-bg-state-warn-bg niuu-text-state-warn'
                : 'niuu-bg-brand-subtle niuu-text-brand',
            )}
            data-testid="kind-badge"
          >
            {kindLabel(cluster.kind)}
          </span>
          <h3 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">{cluster.name}</h3>
          <span
            className="niuu-rounded niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-tertiary"
            data-testid="realm-badge"
          >
            {cluster.realm}
          </span>
          <span className="niuu-flex niuu-items-center niuu-gap-1" data-testid="status-indicator">
            <StateDot state={clusterStatusState(cluster.status)} />
            <span className="niuu-text-xs niuu-text-text-muted">{cluster.status}</span>
          </span>
        </div>
        <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="action-buttons">
          <button
            className="niuu-rounded niuu-border niuu-border-state-warn niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-font-medium niuu-text-state-warn hover:niuu-bg-state-warn-bg niuu-transition-colors"
            data-testid="cordon-btn"
          >
            Cordon
          </button>
          <button
            className="niuu-rounded niuu-border niuu-border-critical niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-font-medium niuu-text-critical hover:niuu-bg-critical/10 niuu-transition-colors"
            data-testid="drain-btn"
          >
            Drain
          </button>
          <button
            className="niuu-rounded niuu-bg-brand niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-font-medium niuu-text-bg-primary hover:niuu-opacity-90 niuu-transition-opacity"
            data-testid="forge-here-btn"
          >
            Forge Here
          </button>
        </div>
      </div>
      <div className="niuu-flex niuu-flex-wrap niuu-gap-4 niuu-text-xs niuu-text-text-muted niuu-font-mono">
        <span>{cluster.region}</span>
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
  );
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
// DiskResourcePanel — segmented bar with system/pods/logs breakdown
// ---------------------------------------------------------------------------

interface DiskResourcePanelProps {
  disk: ClusterDisk;
}

function DiskResourcePanel({ disk }: DiskResourcePanelProps) {
  const { totalGi, usedGi, systemGi, podsGi, logsGi } = disk;
  const pctUsed = totalGi > 0 ? Math.round((usedGi / totalGi) * 100) : 0;

  const segments = [
    { label: 'system', value: systemGi, color: DISK_SEGMENT_COLORS.system },
    { label: 'pods', value: podsGi, color: DISK_SEGMENT_COLORS.pods },
    { label: 'logs', value: logsGi, color: DISK_SEGMENT_COLORS.logs },
  ];

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-gap-1 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
      data-testid="resource-panel-disk"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between">
        <span className="niuu-text-xs niuu-font-medium niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
          Disk
        </span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">GiB</span>
      </div>
      <div className="niuu-font-mono niuu-text-lg niuu-font-semibold niuu-text-text-primary">
        {totalGi === 0 ? (
          <span className="niuu-text-text-faint">&mdash;</span>
        ) : (
          <>
            {usedGi}
            <span className="niuu-text-text-faint">/</span>
            {totalGi}
          </>
        )}
      </div>

      {/* Segmented bar */}
      <div
        className="niuu-flex niuu-h-1.5 niuu-overflow-hidden niuu-rounded-full niuu-bg-bg-elevated"
        role="meter"
        aria-valuenow={pctUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Disk ${pctUsed}%`}
        data-testid="disk-segmented-bar"
      >
        {totalGi > 0 &&
          segments.map((seg) => (
            <div
              key={seg.label}
              className={cn('niuu-h-full', seg.color)}
              style={{ width: `${((seg.value / totalGi) * 100).toFixed(1)}%` }}
              data-testid={`disk-segment-${seg.label}`}
            />
          ))}
      </div>

      <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
        {totalGi === 0 ? 'not provisioned' : `${pctUsed}% used`}
      </span>

      {/* Legend */}
      {totalGi > 0 && (
        <div className="niuu-flex niuu-flex-wrap niuu-gap-3 niuu-mt-1" data-testid="disk-legend">
          {segments.map((seg) => (
            <span
              key={seg.label}
              className="niuu-flex niuu-items-center niuu-gap-1 niuu-text-[10px] niuu-font-mono niuu-text-text-faint"
            >
              <span
                className={cn('niuu-inline-block niuu-h-2 niuu-w-2 niuu-rounded-full', seg.color)}
              />
              {seg.label} {seg.value}Gi
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableHeader — column header for the pods table
// ---------------------------------------------------------------------------

interface SortableHeaderProps {
  label: string;
  field: SortField;
  activeField: SortField;
  dir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}

function SortableHeader({
  label,
  field,
  activeField,
  dir,
  onSort,
  className,
}: SortableHeaderProps) {
  const isActive = field === activeField;
  return (
    <button
      className={cn(
        'niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-font-medium niuu-text-text-muted hover:niuu-text-text-primary niuu-transition-colors niuu-cursor-pointer niuu-select-none niuu-text-left',
        isActive && 'niuu-text-text-primary',
        className,
      )}
      onClick={() => onSort(field)}
      data-testid={`sort-${field}`}
    >
      {label}
      {isActive && <span className="niuu-ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PodRow — single pod row in the pods table
// ---------------------------------------------------------------------------

interface PodRowProps {
  pod: ClusterPod;
}

function PodRow({ pod }: PodRowProps) {
  const cpuPct = pod.cpuLimit > 0 ? pod.cpuUsed / pod.cpuLimit : 0;
  const memPct = pod.memLimitMi > 0 ? pod.memUsedMi / pod.memLimitMi : 0;

  return (
    <li
      className="niuu-grid niuu-grid-cols-[1fr_auto_auto_80px_80px_auto] niuu-items-center niuu-gap-3 niuu-rounded niuu-px-2 niuu-py-1.5 hover:niuu-bg-bg-tertiary"
      data-testid="pod-row"
    >
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-min-w-0">
        <StateDot state={podStatusState(pod.status)} pulse={pod.status === 'running'} />
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary niuu-truncate">
          {pod.name}
        </span>
      </div>
      <span
        className={cn(
          'niuu-rounded-full niuu-px-1.5 niuu-py-0.5 niuu-text-[10px] niuu-font-medium',
          pod.status === 'running' && 'niuu-bg-state-ok-bg niuu-text-state-ok',
          pod.status === 'idle' && 'niuu-bg-bg-elevated niuu-text-text-muted',
          pod.status === 'pending' && 'niuu-bg-state-warn-bg niuu-text-state-warn',
          pod.status === 'failed' && 'niuu-bg-critical/10 niuu-text-critical',
          pod.status === 'succeeded' && 'niuu-bg-state-ok-bg niuu-text-state-ok',
        )}
        data-testid="pod-status-badge"
      >
        {pod.status}
      </span>
      <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint" data-testid="pod-age">
        {relTime(pod.startedAt)}
      </span>
      <div className="niuu-flex niuu-gap-1">
        <MiniBar value={cpuPct} label="cpu" />
      </div>
      <div className="niuu-flex niuu-gap-1">
        <MiniBar value={memPct} label="mem" />
      </div>
      <span
        className="niuu-font-mono niuu-text-xs niuu-text-text-faint niuu-text-right"
        data-testid="pod-restarts"
      >
        {pod.restarts > 0 ? pod.restarts : '—'}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// PodsPanel — pod list with sortable columns
// ---------------------------------------------------------------------------

interface PodsPanelProps {
  cluster: Cluster;
}

function PodsPanel({ cluster }: PodsPanelProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sortedPods = useMemo(() => {
    return [...cluster.pods].sort((a, b) => comparePods(a, b, sortField, sortDir));
  }, [cluster.pods, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir('asc');
  }

  return (
    <section
      className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-primary niuu-p-4"
      aria-label={`Pods on ${cluster.name}`}
      data-testid="pods-panel"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between">
        <h3 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Pods on this forge</h3>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint" data-testid="pod-count">
          {cluster.pods.length}
        </span>
      </div>
      {cluster.pods.length === 0 ? (
        <p className="niuu-font-mono niuu-text-xs niuu-text-text-muted" data-testid="no-pods">
          no active pods
        </p>
      ) : (
        <>
          {/* Sortable column headers */}
          <div
            className="niuu-grid niuu-grid-cols-[1fr_auto_auto_80px_80px_auto] niuu-items-center niuu-gap-3 niuu-px-2 niuu-border-b niuu-border-border-subtle niuu-pb-1"
            data-testid="pods-table-header"
          >
            <SortableHeader
              label="Name"
              field="name"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Status"
              field="status"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Age"
              field="age"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="CPU"
              field="cpu"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Mem"
              field="memory"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Restarts"
              field="restarts"
              activeField={sortField}
              dir={sortDir}
              onSort={handleSort}
              className="niuu-text-right"
            />
          </div>
          <ul
            className="niuu-flex niuu-flex-col niuu-gap-0.5 niuu-list-none niuu-p-0"
            aria-label="Pod list"
          >
            {sortedPods.map((pod) => (
              <PodRow key={pod.name} pod={pod} />
            ))}
          </ul>
        </>
      )}
    </section>
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
      {/* Detail header with kind/realm/status + actions */}
      <ClusterDetailHeader cluster={cluster} />

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
        <DiskResourcePanel disk={cluster.disk} />
      </section>

      {/* Two-column grid: pods + nodes */}
      <div className="niuu-grid niuu-gap-4 lg:niuu-grid-cols-2">
        {/* Pods panel */}
        <PodsPanel cluster={cluster} />

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
