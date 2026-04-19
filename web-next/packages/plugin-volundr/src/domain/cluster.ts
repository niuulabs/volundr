/** Kubernetes node readiness states. */
export type NodeStatus = 'ready' | 'notready' | 'cordoned';

/** A single node in a cluster. */
export interface ClusterNode {
  readonly id: string;
  readonly status: NodeStatus;
  readonly role: string;
}

/** CPU / memory / GPU quantities for a cluster (aggregate). */
export interface ResourceCapacity {
  readonly cpu: number;
  readonly memMi: number;
  readonly gpu: number;
}

/** A realm-bound cluster that Völundr schedules sessions onto. */
export interface Cluster {
  readonly id: string;
  readonly realm: string;
  readonly name: string;
  readonly capacity: ResourceCapacity;
  readonly used: ResourceCapacity;
  readonly nodes: readonly ClusterNode[];
  readonly runningSessions: number;
  readonly queuedProvisions: number;
}

/** Returns the un-used portion of a cluster's capacity. */
export function availableCapacity(cluster: Cluster): ResourceCapacity {
  return {
    cpu: cluster.capacity.cpu - cluster.used.cpu,
    memMi: cluster.capacity.memMi - cluster.used.memMi,
    gpu: cluster.capacity.gpu - cluster.used.gpu,
  };
}

/** Returns true when the cluster has at least one ready node. */
export function isClusterHealthy(cluster: Cluster): boolean {
  return cluster.nodes.some((n) => n.status === 'ready');
}

/** Returns the count of nodes in each status bucket. */
export function nodeStatusCounts(cluster: Cluster): Record<NodeStatus, number> {
  const counts: Record<NodeStatus, number> = { ready: 0, notready: 0, cordoned: 0 };
  for (const node of cluster.nodes) {
    counts[node.status] += 1;
  }
  return counts;
}
