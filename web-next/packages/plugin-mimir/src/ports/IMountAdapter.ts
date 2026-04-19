import type { Mount } from '@niuulabs/domain';
import type { WriteRoutingRule } from '../domain/routing';
import type { RavnBinding } from '../domain/ravn-binding';

/**
 * Port: IMountAdapter
 *
 * Provides access to the set of Mímir mounts registered in a deployment,
 * including write-routing rules and ravn mount bindings.
 */
export interface IMountAdapter {
  /** List all registered mounts and their current status. */
  listMounts(): Promise<Mount[]>;

  /** List write-routing rules, ordered by ascending priority. */
  listRoutingRules(): Promise<WriteRoutingRule[]>;

  /**
   * Create or update a write-routing rule.
   * Returns the persisted rule (server may assign an id for new rules).
   */
  upsertRoutingRule(rule: WriteRoutingRule): Promise<WriteRoutingRule>;

  /** Delete a routing rule by id. No-op if the id does not exist. */
  deleteRoutingRule(id: string): Promise<void>;

  /** List ravn bindings — each ravn's mount access and last dream summary. */
  listRavnBindings(): Promise<RavnBinding[]>;
}
