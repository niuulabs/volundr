import type { Mount } from '@niuulabs/domain';

/**
 * A single entry in the recent-writes activity feed.
 * Displayed on the Overview screen in reverse-chronological order.
 */
export interface RecentWrite {
  id: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  mount: string;
  /** Page path that was written, or empty string for non-page events. */
  page: string;
  /** Ravn that performed the write. */
  ravn: string;
  kind: 'write' | 'compile' | 'lint-fix' | 'dream';
  message: string;
}

/**
 * Port: IMountAdapter
 *
 * Provides access to the set of Mímir mounts registered in a deployment.
 * Each mount is a standalone knowledge-base instance with its own storage,
 * embedding model, and health signal.
 */
export interface IMountAdapter {
  /** List all registered mounts and their current status. */
  listMounts(): Promise<Mount[]>;

  /**
   * Fetch the most recent write events across all mounts, newest first.
   * Used by the Overview screen's activity feed.
   */
  getRecentWrites(limit?: number): Promise<RecentWrite[]>;
}
