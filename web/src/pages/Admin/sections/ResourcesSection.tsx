import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import type { ClusterResourceInfo, ResourceType, NodeResourceSummary } from '@/models';
import type { IVolundrService } from '@/ports';
import { cn } from '@/utils/classnames';
import styles from './ResourcesSection.module.css';

/**
 * Parse a Kubernetes quantity string (e.g. "8024304Ki", "929001317467", "4Gi")
 * into a raw byte count. Returns NaN for non-byte values.
 */
function parseK8sBytes(raw: string): number {
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?)?$/);
  if (!match) return parseFloat(raw) || 0;
  const num = parseFloat(match[1]);
  const suffix = match[2] ?? '';
  const multipliers: Record<string, number> = {
    '': 1,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  return num * (multipliers[suffix] ?? 1);
}

function formatHumanBytes(bytes: number): string {
  if (bytes >= 1024 ** 5) return `${(bytes / 1024 ** 5).toFixed(1)} PiB`;
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TiB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function formatResourceValue(value: number | string, unit: string): string {
  const raw = String(value);
  if (unit === 'bytes') {
    return formatHumanBytes(parseK8sBytes(raw));
  }
  const num = parseFloat(raw) || 0;
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1);
}

function calculateUtilization(allocated: string, allocatable: string): number {
  const alloc = parseFloat(allocated) || 0;
  const total = parseFloat(allocatable) || 0;
  if (total === 0) {
    return 0;
  }
  return Math.round((alloc / total) * 100);
}

function getUtilizationStatus(pct: number): 'healthy' | 'warning' | 'critical' {
  if (pct >= 90) {
    return 'critical';
  }
  if (pct >= 70) {
    return 'warning';
  }
  return 'healthy';
}

interface AggregatedResource {
  resourceType: ResourceType;
  allocatable: number;
  allocated: number;
  available: number;
}

function parseNodeValue(raw: string, unit: string): number {
  if (unit === 'bytes') return parseK8sBytes(raw);
  return parseFloat(raw) || 0;
}

function aggregateResources(
  resourceTypes: ResourceType[],
  nodes: NodeResourceSummary[]
): AggregatedResource[] {
  return resourceTypes.map(rt => {
    let allocatable = 0;
    let allocated = 0;
    let available = 0;

    for (const node of nodes) {
      allocatable += parseNodeValue(node.allocatable[rt.resourceKey] ?? '0', rt.unit);
      allocated += parseNodeValue(node.allocated[rt.resourceKey] ?? '0', rt.unit);
      available += parseNodeValue(node.available[rt.resourceKey] ?? '0', rt.unit);
    }

    return { resourceType: rt, allocatable, allocated, available };
  });
}

interface ResourcesSectionProps {
  service: IVolundrService;
}

export function ResourcesSection({ service }: ResourcesSectionProps) {
  const [resources, setResources] = useState<ClusterResourceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.getClusterResources();
      setResources(data);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const aggregated = useMemo(() => {
    if (!resources) {
      return [];
    }
    return aggregateResources(resources.resourceTypes, resources.nodes);
  }, [resources]);

  if (loading) {
    return <div className={styles.loadingSpinner}>Loading cluster resources...</div>;
  }

  return (
    <div className={styles.section}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Cluster Resources</span>
        <button type="button" className={styles.refreshButton} onClick={loadResources}>
          <RefreshCw className={styles.refreshIcon} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className={styles.summaryCards}>
        {aggregated.map(agg => (
          <div
            key={agg.resourceType.resourceKey}
            className={styles.summaryCard}
            data-category={agg.resourceType.category}
          >
            <div className={styles.summaryLabel}>{agg.resourceType.displayName}</div>
            <div className={styles.summaryValue}>
              {formatResourceValue(agg.available, agg.resourceType.unit)}{' '}
              {agg.resourceType.unit === 'bytes' ? '' : agg.resourceType.unit}
            </div>
            <div className={styles.summaryDetail}>
              {formatResourceValue(agg.allocated, agg.resourceType.unit)} /{' '}
              {formatResourceValue(agg.allocatable, agg.resourceType.unit)} used
            </div>
          </div>
        ))}
      </div>

      {/* Node table */}
      {resources && resources.nodes.length === 0 ? (
        <div className={styles.emptyState}>
          <Cpu className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>
            No node-level data available. Resource discovery is using a static provider.
          </span>
        </div>
      ) : (
        resources && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeader}>Node</th>
                {resources.resourceTypes.map(rt => (
                  <th key={rt.resourceKey} className={styles.tableHeader}>
                    {rt.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.nodes.map(node => (
                <tr key={node.name} className={styles.tableRow}>
                  <td className={cn(styles.tableCell, styles.nodeCell)}>{node.name}</td>
                  {resources.resourceTypes.map(rt => {
                    const allocated = node.allocated[rt.resourceKey] ?? '0';
                    const allocatable = node.allocatable[rt.resourceKey] ?? '0';
                    const pct = calculateUtilization(allocated, allocatable);
                    const status = getUtilizationStatus(pct);
                    return (
                      <td
                        key={rt.resourceKey}
                        className={cn(styles.tableCell, styles.resourceCell)}
                      >
                        {formatResourceValue(allocated, rt.unit)} /{' '}
                        {formatResourceValue(allocatable, rt.unit)}{' '}
                        <span className={styles.utilizationBadge} data-status={status}>
                          {pct}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
