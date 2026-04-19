import type { PageMeta, Page, SearchResult } from '../domain/page';
import type { MimirStats, MimirGraph } from '../domain/api-types';
import type { EntityKind, EntityMeta } from '../domain/entity';

export type SearchMode = 'fts' | 'semantic' | 'hybrid';

/**
 * Port: IPageStore
 *
 * CRUD and search over compiled pages. A page store is scoped to one or more
 * mounts depending on the adapter implementation.
 */
export interface IPageStore {
  /** Fleet-wide statistics (page count, categories, health). */
  getStats(): Promise<MimirStats>;

  /**
   * List page metadata, optionally filtered by mount and/or category.
   */
  listPages(options?: { mountName?: string; category?: string }): Promise<PageMeta[]>;

  /**
   * Fetch a single page by path.
   * Returns null when no page exists at that path.
   */
  getPage(path: string, mountName?: string): Promise<Page | null>;

  /**
   * Create or update a page at the given path.
   * The write is routed according to the mount's write-routing rules.
   */
  upsertPage(path: string, content: string, mountName?: string): Promise<void>;

  /**
   * Full-text, semantic, or hybrid search across pages.
   * Defaults to hybrid mode.
   */
  search(query: string, mode?: SearchMode): Promise<SearchResult[]>;

  /**
   * Fetch the knowledge graph (page nodes + relationship edges).
   * Optionally scoped to a single mount.
   */
  getGraph(options?: { mountName?: string }): Promise<MimirGraph>;

  /**
   * List entity pages, optionally filtered by entity kind.
   * Returns lightweight EntityMeta summaries suitable for list views.
   */
  listEntities(options?: { kind?: EntityKind }): Promise<EntityMeta[]>;
}
