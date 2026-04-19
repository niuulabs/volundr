import type { Mount } from '@niuulabs/domain';

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
}
