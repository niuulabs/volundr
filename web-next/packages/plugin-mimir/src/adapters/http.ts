/**
 * HTTP adapter for IMimirService.
 *
 * Adapted from web/src/modules/mimir/api/client.ts.
 * Receives an ApiClient pointed at the Mimir service base URL.
 *
 * New domain methods (listMounts, listDreamCycles, listSources) return stubs
 * until the backend surfaces those endpoints.
 */

import type { ApiClient } from '@niuulabs/query';
import type { IMimirService } from '../ports/IMimirService';
import type {
  MimirStats,
  MimirPageMeta,
  Page,
  MimirSearchResult,
  MimirLogEntry,
  LintReport,
  LintIssue,
  LintRule,
  MimirGraph,
  GraphNode,
  GraphEdge,
  IngestRequest,
  IngestResponse,
  DreamCycle,
  Source,
  Mount,
  PageType,
  PageConfidence,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Raw response types (snake_case from the API)
// ---------------------------------------------------------------------------

interface RawPageMeta {
  path: string;
  title: string;
  summary: string;
  category: string;
  updated_at: string;
  source_ids?: string[];
}

interface RawPage extends RawPageMeta {
  content?: string;
  type?: string;
  confidence?: string;
  entity_type?: string;
  mounts?: string[];
  updated_by?: string;
  related?: string[];
  size?: number;
}

interface RawStats {
  page_count: number;
  categories: string[];
  healthy: boolean;
}

interface RawLintIssue {
  id: string;
  rule?: string;
  severity: string;
  message: string;
  page_path: string;
  mount?: string;
  assignee?: string;
  auto_fix: boolean;
  suggested_fix?: string;
}

interface RawLintReport {
  issues: RawLintIssue[];
  pages_checked: number;
  issues_found: boolean;
  summary: { error: number; warning: number; info: number };
}

interface RawLogEntry {
  raw: string;
  entries: string[];
}

interface RawGraphNode {
  id: string;
  title: string;
  category: string;
}

interface RawGraphEdge {
  source: string;
  target: string;
}

interface RawGraph {
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
}

interface RawIngestResponse {
  source_id: string;
  pages_updated: string[];
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

function toMeta(raw: RawPageMeta): MimirPageMeta {
  return {
    path: raw.path,
    title: raw.title,
    summary: raw.summary,
    category: raw.category,
    updatedAt: raw.updated_at,
    sourceIds: raw.source_ids ?? [],
  };
}

function toPage(raw: RawPage): Page {
  return {
    path: raw.path,
    title: raw.title,
    type: (raw.type as PageType | undefined) ?? 'topic',
    confidence: (raw.confidence as PageConfidence | undefined) ?? 'medium',
    entityType: raw.entity_type,
    category: raw.category,
    summary: raw.summary,
    mounts: raw.mounts ?? [],
    updatedAt: raw.updated_at,
    updatedBy: raw.updated_by ?? 'unknown',
    sourceIds: raw.source_ids ?? [],
    related: raw.related ?? [],
    size: raw.size ?? 0,
    zones: [],
  };
}

function toStats(raw: RawStats): MimirStats {
  return {
    pageCount: raw.page_count,
    categories: raw.categories,
    healthy: raw.healthy,
  };
}

function toLintIssue(raw: RawLintIssue): LintIssue {
  return {
    id: raw.id,
    rule: (raw.rule as LintRule | undefined) ?? 'L12',
    severity: raw.severity as LintIssue['severity'],
    message: raw.message,
    pagePath: raw.page_path,
    mount: raw.mount ?? '',
    assignee: raw.assignee,
    autoFix: raw.auto_fix,
    suggestedFix: raw.suggested_fix,
  };
}

function toLintReport(raw: RawLintReport): LintReport {
  return {
    issues: raw.issues.map(toLintIssue),
    pagesChecked: raw.pages_checked,
    issuesFound: raw.issues_found,
    summary: raw.summary,
  };
}

function toLogEntry(raw: RawLogEntry): MimirLogEntry {
  return {
    raw: raw.raw,
    entries: raw.entries,
  };
}

function toSearchResult(raw: RawPageMeta): MimirSearchResult {
  return {
    path: raw.path,
    title: raw.title,
    summary: raw.summary,
    category: raw.category,
  };
}

function toGraphNode(raw: RawGraphNode): GraphNode {
  return {
    id: raw.id,
    title: raw.title,
    category: raw.category,
  };
}

function toGraphEdge(raw: RawGraphEdge): GraphEdge {
  return {
    source: raw.source,
    target: raw.target,
  };
}

function toGraph(raw: RawGraph): MimirGraph {
  return {
    nodes: raw.nodes.map(toGraphNode),
    edges: raw.edges.map(toGraphEdge),
  };
}

function toIngestResponse(raw: RawIngestResponse): IngestResponse {
  return {
    sourceId: raw.source_id,
    pagesUpdated: raw.pages_updated,
  };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a Mimir service backed by the Mimir HTTP API.
 *
 * @param client - ApiClient pointed at the Mimir service base path (e.g. /mimir)
 */
export function createHttpMimirService(client: ApiClient): IMimirService {
  return {
    // --- IMountAdapter ---
    async listMounts(): Promise<Mount[]> {
      return client.get<Mount[]>('/mounts');
    },

    async getStats(): Promise<MimirStats> {
      const raw = await client.get<RawStats>('/stats');
      return toStats(raw);
    },

    // --- IPageStore ---
    async listPages(opts?) {
      const qs = opts?.category ? `?category=${encodeURIComponent(opts.category)}` : '';
      const raw = await client.get<RawPageMeta[]>(`/pages${qs}`);
      return raw.map(toMeta);
    },

    async getPage(path: string): Promise<Page> {
      const raw = await client.get<RawPage>(`/page?path=${encodeURIComponent(path)}`);
      return toPage(raw);
    },

    async upsertPage(path: string, content: string): Promise<void> {
      await client.put<void>('/page', { path, content });
    },

    // --- IEmbeddingStore ---
    async search(query: string, opts?): Promise<MimirSearchResult[]> {
      const mode = opts?.mode ?? 'hybrid';
      const raw = await client.get<RawPageMeta[]>(
        `/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`,
      );
      return raw.map(toSearchResult);
    },

    async getGraph(): Promise<MimirGraph> {
      const raw = await client.get<RawGraph>('/graph');
      return toGraph(raw);
    },

    // --- ILintEngine ---
    async getLint(_mountName?: string): Promise<LintReport> {
      const raw = await client.get<RawLintReport>('/lint');
      return toLintReport(raw);
    },

    async lintFix(_issueIds?: string[]): Promise<LintReport> {
      const raw = await client.post<RawLintReport>('/lint/fix', {});
      return toLintReport(raw);
    },

    // --- additional ---
    async getLog(n = 50): Promise<MimirLogEntry> {
      const raw = await client.get<RawLogEntry>(`/log?n=${n}`);
      return toLogEntry(raw);
    },

    async ingest(request: IngestRequest): Promise<IngestResponse> {
      const raw = await client.post<RawIngestResponse>('/ingest', {
        title: request.title,
        content: request.content,
        source_type: request.sourceType,
        origin_url: request.originUrl,
      });
      return toIngestResponse(raw);
    },

    async listDreamCycles(): Promise<DreamCycle[]> {
      return client.get<DreamCycle[]>('/dream-cycles');
    },

    async listSources(_mountName?: string): Promise<Source[]> {
      return client.get<Source[]>('/sources');
    },
  };
}
