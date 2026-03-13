import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import type { ClusterResourceInfo, ResourceType, NodeResourceSummary } from '@/models';
import type { IVolundrService } from '@/ports';
import { cn } from '@/utils/classnames';
import { parseK8sQuantity, formatResourceValue } from '@/utils/k8sQuantity';
import styles from './ResourcesSection.module.css';

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
  const parsed = parseK8sQuantity(raw, unit);
  return isNaN(parsed) ? 0 : parsed;
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
