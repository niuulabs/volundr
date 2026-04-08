import type { MimirApiPort } from '@/ports';
import type {
  MimirStats,
  MimirPageMeta,
  MimirPage,
  MimirSearchResult,
  MimirLintReport,
  MimirLogEntry,
} from '@/domain';

function toMeta(raw: Record<string, unknown>): MimirPageMeta {
  return {
    path: raw['path'] as string,
    title: raw['title'] as string,
    summary: raw['summary'] as string,
    category: raw['category'] as string,
    updatedAt: raw['updated_at'] as string,
    sourceIds: (raw['source_ids'] as string[]) ?? [],
  };
}

/**
 * HttpMimirAdapter — implements MimirApiPort by calling a live Mímir HTTP service.
 *
 * The base URL is the full prefix before the path segments, e.g.:
 *   http://localhost:7477/mimir
 */
export class HttpMimirAdapter implements MimirApiPort {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`Mímir HTTP ${res.status}: ${path}`);
    }
    return res.json() as Promise<T>;
  }

  private async put(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Mímir HTTP ${res.status}: PUT ${path}`);
    }
  }

  async getStats(): Promise<MimirStats> {
    const raw = await this.get<Record<string, unknown>>('/stats');
    return {
      pageCount: raw['page_count'] as number,
      categories: raw['categories'] as string[],
      healthy: raw['healthy'] as boolean,
    };
  }

  async listPages(category?: string): Promise<MimirPageMeta[]> {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    const raw = await this.get<Record<string, unknown>[]>(`/pages${qs}`);
    return raw.map(toMeta);
  }

  async getPage(path: string): Promise<MimirPage> {
    const raw = await this.get<Record<string, unknown>>(`/page?path=${encodeURIComponent(path)}`);
    return {
      ...toMeta(raw),
      content: raw['content'] as string,
    };
  }

  async search(query: string): Promise<MimirSearchResult[]> {
    const raw = await this.get<Record<string, unknown>[]>(`/search?q=${encodeURIComponent(query)}`);
    return raw.map((r) => ({
      path: r['path'] as string,
      title: r['title'] as string,
      summary: r['summary'] as string,
      category: r['category'] as string,
    }));
  }

  async getLog(n = 50): Promise<MimirLogEntry> {
    const raw = await this.get<Record<string, unknown>>(`/log?n=${n}`);
    return {
      raw: raw['raw'] as string,
      entries: raw['entries'] as string[],
    };
  }

  async getLint(): Promise<MimirLintReport> {
    const raw = await this.get<Record<string, unknown>>('/lint');
    return {
      orphans: raw['orphans'] as string[],
      contradictions: raw['contradictions'] as string[],
      stale: raw['stale'] as string[],
      gaps: raw['gaps'] as string[],
      pagesChecked: raw['pages_checked'] as number,
      issuesFound: raw['issues_found'] as boolean,
    };
  }

  async upsertPage(path: string, content: string): Promise<void> {
    await this.put('/page', { path, content });
  }
}
