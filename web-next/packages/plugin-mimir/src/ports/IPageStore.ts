import type { MimirPageMeta, Page } from '../domain/types';

export interface ListPagesOpts {
  /** Filter by category. */
  category?: string;
  /** Filter by mount name. */
  mount?: string;
}

/**
 * Port: page CRUD and log access.
 */
export interface IPageStore {
  /** List page metadata, optionally filtered. */
  listPages(opts?: ListPagesOpts): Promise<MimirPageMeta[]>;
  /** Fetch a single page with structured zones. */
  getPage(path: string): Promise<Page>;
  /** Create or update a page's compiled content. */
  upsertPage(path: string, content: string): Promise<void>;
}
