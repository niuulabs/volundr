/** Cluster domain — capacity, utilization, and node health for a Völundr cluster. */

export type NodeStatus = 'ready' | 'notready' | 'cordoned';

export interface ClusterNode {
  id: string;
  status: NodeStatus;
  role: string;
}

export interface ClusterCapacity {
  cpu: number;
  memMi: number;
  gpu: number;
}

/** A named cluster (realm-bound) onto which Völundr schedules sessions. */
export interface Cluster {
  id: string;
  realm: string;
  name: string;
  capacity: ClusterCapacity;
  used: ClusterCapacity;
  nodes: ClusterNode[];
  runningSessions: number;
  queuedProvisions: number;
}
