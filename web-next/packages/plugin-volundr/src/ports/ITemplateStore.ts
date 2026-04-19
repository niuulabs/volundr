/**
 * Port for template persistence.
 */
import type { Template } from '../domain/template';

export interface ITemplateStore {
  /** Fetch a single template by ID, or null if not found. */
  get(id: string): Promise<Template | null>;

  /** List all templates. */
  list(): Promise<Template[]>;

  /** Persist a new or updated template. */
  save(template: Template): Promise<Template>;

  /** Remove a template. */
  delete(id: string): Promise<void>;
}
