import type { TopologySnapshot } from '../domain/topology';

export interface ILiveTopologyStream {
  /** Subscribe to topology snapshots. Returns an unsubscribe function. */
  subscribe(onUpdate: (snapshot: TopologySnapshot) => void): () => void;
}
