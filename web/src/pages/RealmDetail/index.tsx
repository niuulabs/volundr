import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Radio, Server, HardDrive } from 'lucide-react';
import { StatusBadge, StatusDot, ResourceBar, FilterTabs } from '@/components';
import { useRealmDetail } from '@/hooks';
import type { NodeSnapshot, InfraEvent, EventSeverity } from '@/models';
import { cn, formatBytes, formatResourcePair } from '@/utils';
import styles from './RealmDetailPage.module.css';

function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function NodeCard({ node }: { node: NodeSnapshot }) {
  return (
    <div className={styles.nodeCard}>
      <div className={styles.nodeHeader}>
        <p className={styles.nodeName}>{node.name}</p>
        <StatusDot status={node.status === 'Ready' ? 'healthy' : 'warning'} pulse />
      </div>
      {node.roles.length > 0 && (
        <div className={styles.nodeRoles}>
          {node.roles.map(role => (
            <span key={role} className={styles.roleTag}>
              {role}
            </span>
          ))}
        </div>
      )}
      <div className={styles.nodeResources}>
        <div className={styles.nodeResource}>
          <span>CPU</span>
          <span>
            {node.cpu.allocatable}/{node.cpu.capacity} {node.cpu.unit}
          </span>
        </div>
        <div className={styles.nodeResource}>
          <span>Memory</span>
          <span>
            {formatResourcePair(node.memory.allocatable, node.memory.capacity, node.memory.unit)}
          </span>
        </div>
        {node.gpuCount > 0 && (
          <div className={styles.nodeResource}>
            <span>GPUs</span>
            <span>{node.gpuCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: InfraEvent }) {
  const severityStatus =
    event.severity === 'error' ? 'critical' : event.severity === 'warning' ? 'warning' : 'healthy';

  return (
    <div className={styles.eventRow}>
      <span className={styles.eventTime}>{formatEventTime(event.timestamp)}</span>
      <StatusDot status={severityStatus} />
      <span className={styles.eventSource}>{event.source}</span>
      <span className={styles.eventMessage}>{event.message}</span>
    </div>
  );
}

export function RealmDetailPage() {
  const { realmId } = useParams<{ realmId: string }>();
  const navigate = useNavigate();
  const { detail, loading, error } = useRealmDetail(realmId);
  const [eventFilter, setEventFilter] = useState<string>('all');

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading realm...</div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>{error?.message ?? 'Realm not found'}</div>
      </div>
    );
  }

  const pods = detail.resources.pods;
  const totalPods = pods.running + pods.pending + pods.failed + pods.unknown;
  const storageUsedPct =
    detail.storage.totalCapacityBytes > 0
      ? Math.round((detail.storage.usedBytes / detail.storage.totalCapacityBytes) * 100)
      : 0;

  const filteredEvents =
    eventFilter === 'all'
      ? detail.events
      : detail.events.filter(e => e.severity === (eventFilter as EventSeverity));

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/realms')}>
            <ArrowLeft className={styles.backIcon} />
            Realms
          </button>
          <div className={styles.titleGroup}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{detail.name}</h1>
              <StatusBadge status={detail.status} />
            </div>
            <p className={styles.meta}>
              {detail.description} &middot; {detail.location}
            </p>
          </div>
        </div>
      </div>

      {/* Valkyrie Banner */}
      <div className={styles.valkyrieBanner}>
        <div className={styles.valkyrieIconBox}>
          <Radio className={styles.valkyrieIcon} />
        </div>
        {detail.valkyrie ? (
          <>
            <div className={styles.valkyrieInfo}>
              <p className={styles.valkyrieName}>{detail.valkyrie.name}</p>
              <p className={styles.valkyrieSpecialty}>{detail.valkyrie.specialty}</p>
              <span className={styles.valkyrieStub}>Not yet deployed</span>
            </div>
            <div className={styles.valkyrieMeta}>
              <div className={styles.valkyrieMetaItem}>
                <p className={styles.valkyrieMetaValue}>{detail.valkyrie.observationsToday}</p>
                <p className={styles.valkyrieMetaLabel}>observations</p>
              </div>
              <div className={styles.valkyrieMetaItem}>
                <p className={cn(styles.valkyrieMetaValue, styles.valkyrieMetaMono)}>
                  {detail.valkyrie.uptime}
                </p>
                <p className={styles.valkyrieMetaLabel}>uptime</p>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.valkyrieInfo}>
            <p className={styles.valkyrieName}>No Valkyrie assigned</p>
            <span className={styles.valkyrieStub}>This realm has no observer</span>
          </div>
        )}
      </div>

      {/* Metric Tiles */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricTile}>
          <p className={styles.metricLabel}>CPU</p>
          <p className={styles.metricValue}>
            {detail.resources.cpu.allocatable}/{detail.resources.cpu.capacity}
          </p>
          <p className={styles.metricSub}>{detail.resources.cpu.unit} allocatable</p>
        </div>
        <div className={styles.metricTile}>
          <p className={styles.metricLabel}>Memory</p>
          <p className={styles.metricValue}>
            {formatResourcePair(
              detail.resources.memory.allocatable,
              detail.resources.memory.capacity,
              detail.resources.memory.unit
            )}
          </p>
          <p className={styles.metricSub}>allocatable</p>
        </div>
        <div className={styles.metricTile}>
          <p className={styles.metricLabel}>Pods</p>
          <p className={styles.metricValue}>
            {pods.running}/{totalPods}
          </p>
          <p className={styles.metricSub}>
            running{pods.pending > 0 ? ` · ${pods.pending} pending` : ''}
            {pods.failed > 0 ? ` · ${pods.failed} failed` : ''}
          </p>
        </div>
        {detail.resources.gpuCount > 0 && (
          <div className={styles.metricTile}>
            <p className={styles.metricLabel}>GPUs</p>
            <p className={styles.metricValue}>{detail.resources.gpuCount}</p>
            <p className={styles.metricSub}>allocated</p>
          </div>
        )}
        <div className={styles.metricTile}>
          <p className={styles.metricLabel}>Nodes</p>
          <p className={styles.metricValue}>
            {detail.health.inputs.nodesReady}/{detail.health.inputs.nodesTotal}
          </p>
          <p className={styles.metricSub}>ready</p>
        </div>
      </div>

      {/* Health Reason */}
      {detail.health.reason && (
        <div className={styles.section}>
          <StatusDot status="warning" />
          <span className={styles.metricSub}> {detail.health.reason}</span>
        </div>
      )}

      {/* Nodes + Workloads */}
      <div className={styles.twoCol}>
        {/* Nodes */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <Server className={styles.sectionTitleIcon} />
              Nodes
            </h2>
            <span className={styles.sectionSub}>{detail.nodes.length} total</span>
          </div>
          {detail.nodes.length > 0 ? (
            <div className={styles.nodesGrid}>
              {detail.nodes.map(node => (
                <NodeCard key={node.name} node={node} />
              ))}
            </div>
          ) : (
            <p className={styles.emptyMessage}>No node data available</p>
          )}
        </div>

        {/* Workloads */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Workloads</h2>
            <span className={styles.sectionSub}>{detail.workloads.namespaceCount} namespaces</span>
          </div>
          <div className={styles.workloadsGrid}>
            <div className={styles.workloadItem}>
              <p className={styles.workloadValue}>
                {detail.workloads.deploymentHealthy}/{detail.workloads.deploymentTotal}
              </p>
              <p className={styles.workloadLabel}>Deployments healthy</p>
            </div>
            <div className={styles.workloadItem}>
              <p className={styles.workloadValue}>{detail.workloads.statefulsetCount}</p>
              <p className={styles.workloadLabel}>StatefulSets</p>
            </div>
            <div className={styles.workloadItem}>
              <p className={styles.workloadValue}>{detail.workloads.daemonsetCount}</p>
              <p className={styles.workloadLabel}>DaemonSets</p>
            </div>
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            <HardDrive className={styles.sectionTitleIcon} />
            Storage
          </h2>
          <span className={styles.sectionSub}>{storageUsedPct}% used</span>
        </div>
        <div className={styles.storageBar}>
          <ResourceBar
            label="Capacity"
            used={detail.storage.usedBytes}
            total={detail.storage.totalCapacityBytes}
            formatValue={formatBytes}
            color="cyan"
          />
        </div>
        <div className={styles.volumeRow}>
          <span className={cn(styles.volumeCount, styles.volumeCountHealthy)}>
            {detail.storage.volumes.healthy} healthy
          </span>
          {detail.storage.volumes.degraded > 0 && (
            <span className={cn(styles.volumeCount, styles.volumeCountDegraded)}>
              {detail.storage.volumes.degraded} degraded
            </span>
          )}
          {detail.storage.volumes.faulted > 0 && (
            <span className={cn(styles.volumeCount, styles.volumeCountFaulted)}>
              {detail.storage.volumes.faulted} faulted
            </span>
          )}
        </div>
        <p className={styles.metricSub}>
          {formatBytes(detail.storage.usedBytes)} / {formatBytes(detail.storage.totalCapacityBytes)}
        </p>
      </div>

      {/* Events */}
      <div className={styles.section}>
        <div className={styles.eventsHeader}>
          <h2 className={styles.sectionTitle}>Recent Events</h2>
          <FilterTabs
            options={['all', 'info', 'warning', 'error']}
            value={eventFilter}
            onChange={setEventFilter}
          />
        </div>
        {filteredEvents.length > 0 ? (
          <div className={styles.eventsList}>
            {filteredEvents.map((event, i) => (
              <EventRow key={`${event.timestamp}-${i}`} event={event} />
            ))}
          </div>
        ) : (
          <p className={styles.emptyMessage}>No events</p>
        )}
      </div>
    </div>
  );
}
