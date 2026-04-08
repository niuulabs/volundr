import type {
  MimirStats,
  MimirPageMeta,
  MimirPage,
  MimirSearchResult,
  MimirLintReport,
  MimirLogEntry,
} from '@/domain';

/**
 * Port interface for all read/write operations against a single Mímir instance.
 * Components import this interface — never adapter implementations.
 */
export interface MimirApiPort {
  /** Top-level stats: page count, categories, health */
  getStats(): Promise<MimirStats>;

  /** List all pages, optionally filtered by category */
  listPages(category?: string): Promise<MimirPageMeta[]>;

  /** Read a single page by path */
  getPage(path: string): Promise<MimirPage>;

  /** Full-text search across all pages */
  search(query: string): Promise<MimirSearchResult[]>;

  /** Read last N log entries */
  getLog(n?: number): Promise<MimirLogEntry>;

  /** Health report: orphans, contradictions, stale, gaps */
  getLint(): Promise<MimirLintReport>;

  /** Upsert a wiki page (write-enabled instances only) */
  upsertPage(path: string, content: string): Promise<void>;
}
