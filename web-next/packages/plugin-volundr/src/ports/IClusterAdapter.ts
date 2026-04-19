/**
 * Port for the Kubernetes cluster adapter.
 *
 * Abstracts over whatever cluster API (k8s, mock, …) the operator configures.
 */
import type { Cluster } from '../domain/cluster';
import type { Session } from '../domain/session';
import type { PodSpec } from '../domain/pod';

export interface IClusterAdapter {
  /** Fetch the current state of a single cluster. */
  getCluster(clusterId: string): Promise<Cluster | null>;

  /** List all clusters visible to this adapter. */
  listClusters(): Promise<Cluster[]>;

  /**
   * Schedule a new pod for the given session on the given cluster.
   * Returns the pod name on success.
   */
  scheduleSession(session: Session, podSpec: PodSpec): Promise<string>;

  /** Release (delete) the pod backing a session. */
  releaseSession(session: Session): Promise<void>;
}
