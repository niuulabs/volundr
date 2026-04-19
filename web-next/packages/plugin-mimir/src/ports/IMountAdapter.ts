import type { Mount } from '../domain/types';
import type { MimirStats } from '../domain/types';

/**
 * Port: per-mount API access.
 *
 * Implementations may be HTTP (remote Mimir service) or FS (local mount).
 */
export interface IMountAdapter {
  /** List all configured mounts. */
  listMounts(): Promise<Mount[]>;
  /** Fleet-wide health and page/source counts. */
  getStats(): Promise<MimirStats>;
}
