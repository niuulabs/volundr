import type { MimirSearchResult, MimirGraph, SearchMode } from '../domain/types';

export interface SearchOpts {
  /** Search mode (default: 'hybrid'). */
  mode?: SearchMode;
  /** Restrict search to a single mount. */
  mount?: string;
}

/**
 * Port: vector embedding store and graph retrieval.
 *
 * Implementations include a local MiniLM/mpnet index or a remote embedding service.
 */
export interface IEmbeddingStore {
  /** Run FTS, semantic, or hybrid search across pages. */
  search(query: string, opts?: SearchOpts): Promise<MimirSearchResult[]>;
  /** Retrieve the page-to-page relationship graph. */
  getGraph(): Promise<MimirGraph>;
}
