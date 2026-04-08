import type { MimirGraph } from '@/domain';

/**
 * Port interface for fetching the wiki link graph for visualisation.
 */
export interface GraphPort {
  /** Fetch all nodes and edges for the force-directed graph */
  getGraph(): Promise<MimirGraph>;
}
