/**
 * HTTP adapter for the Mímir service.
 *
 * Accepts an ApiClient scoped to the Mímir base URL and implements
 * IMimirService by mapping HTTP responses to domain types.
 */

import type { ApiClient } from '@niuulabs/query';
import type { Mount } from '@niuulabs/domain';
import type { IMimirService, SearchMode } from '../ports';
import type { PageMeta, Page, SearchResult } from '../domain/page';
import type { LintReport, DreamCycle, LintIssue, IssueSeverity, LintRule } from '../domain/lint';
import type { MimirStats, MimirGraph, GraphNode, GraphEdge } from '../domain/api-types';
import type { EmbeddingSearchResult } from '../ports/IEmbeddingStore';
import type { EntityKind, EntityMeta } from '../domain/entity';
import { tallySeverity } from '../domain/lint';

// ---------------------------------------------------------------------------
// Raw wire types
// ---------------------------------------------------------------------------

interface RawMount {
  name: string;
  role: string;
  host: string;
  url: string;
  priority: number;
  categories: string[] | null;
  status: string;
  pages: number;
  sources: number;
  lint_issues: number;
  last_write: string;
  embedding: string;
  size_kb: number;
  desc: string;
}

interface RawPageMeta {
  path: string;
  title: string;
  summary: string;
  category: string;
  type: string;
  confidence: string;
  entity_type?: string;
  mounts: string[];
  updated_at: string;
  updated_by: string;
  source_ids: string[];
  size: number;
}

interface RawPage extends RawPageMeta {
  related: string[];
  zones?: Array<{
    kind: string;
    items?: unknown[];
    text?: string;
  }>;
}

interface RawStats {
  page_count: number;
  categories: string[];
  healthy: boolean;
}

interface RawSearchResult {
  path: string;
  title: string;
  summary: string;
  category: string;
  type: string;
  confidence: string;
}

interface RawLintIssue {
  id: string;
  rule: string;
  severity: string;
  page: string;
  mount: string;
  assignee?: string;
  auto_fix: boolean;
  message: string;
}

interface RawLintReport {
  issues: RawLintIssue[];
  pages_checked: number;
}

interface RawEmbeddingResult {
  path: string;
  title: string;
  summary: string;
  score: number;
  mount_name: string;
}

interface RawDreamCycle {
  id: string;
  timestamp: string;
  ravn: string;
  mounts: string[];
  pages_updated: number;
  entities_created: number;
  lint_fixes: number;
  duration_ms: number;
}

interface RawGraphNode {
  id: string;
  title: string;
  category: string;
  inbound_count?: number;
}

interface RawGraphEdge {
  source: string;
  target: string;
}

interface RawGraph {
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
}

interface RawEntityMeta {
  path: string;
  title: string;
  entity_kind: string;
  summary: string;
  relationship_count: number;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toMount(raw: RawMount): Mount {
  return {
    name: raw.name,
    role: raw.role as Mount['role'],
    host: raw.host,
    url: raw.url,
    priority: raw.priority,
    categories: raw.categories,
    status: raw.status as Mount['status'],
    pages: raw.pages,
    sources: raw.sources,
    lintIssues: raw.lint_issues,
    lastWrite: raw.last_write,
    embedding: raw.embedding,
    sizeKb: raw.size_kb,
    desc: raw.desc,
  };
}

function toPageMeta(raw: RawPageMeta): PageMeta {
  return {
    path: raw.path,
    title: raw.title,
    summary: raw.summary,
    category: raw.category,
    type: raw.type as PageMeta['type'],
    confidence: raw.confidence as PageMeta['confidence'],
    entityType: raw.entity_type,
    mounts: raw.mounts,
    updatedAt: raw.updated_at,
    updatedBy: raw.updated_by,
    sourceIds: raw.source_ids,
    size: raw.size,
  };
}

function toPage(raw: RawPage): Page {
  return {
    ...toPageMeta(raw),
    related: raw.related,
  };
}

function toLintIssue(raw: RawLintIssue): LintIssue {
  return {
    id: raw.id,
    rule: raw.rule as LintRule,
    severity: raw.severity as IssueSeverity,
    page: raw.page,
    mount: raw.mount,
    assignee: raw.assignee,
    autoFix: raw.auto_fix,
    message: raw.message,
  };
}

function toLintReport(raw: RawLintReport): LintReport {
  const issues = raw.issues.map(toLintIssue);
  return {
    issues,
    pagesChecked: raw.pages_checked,
    summary: tallySeverity(issues),
  };
}

function toEmbeddingResult(raw: RawEmbeddingResult): EmbeddingSearchResult {
  return {
    path: raw.path,
    title: raw.title,
    summary: raw.summary,
    score: raw.score,
    mountName: raw.mount_name,
  };
}

function toDreamCycle(raw: RawDreamCycle): DreamCycle {
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    ravn: raw.ravn,
    mounts: raw.mounts,
    pagesUpdated: raw.pages_updated,
    entitiesCreated: raw.entities_created,
    lintFixes: raw.lint_fixes,
    durationMs: raw.duration_ms,
  };
}

function toGraphNode(raw: RawGraphNode): GraphNode {
  return {
    id: raw.id,
    title: raw.title,
    category: raw.category,
    inboundCount: raw.inbound_count,
  };
}

function toGraphEdge(raw: RawGraphEdge): GraphEdge {
  return { source: raw.source, target: raw.target };
}

function toGraph(raw: RawGraph): MimirGraph {
  return {
    nodes: raw.nodes.map(toGraphNode),
    edges: raw.edges.map(toGraphEdge),
  };
}

function toEntityMeta(raw: RawEntityMeta): EntityMeta {
  return {
    path: raw.path,
    title: raw.title,
    entityKind: raw.entity_kind as EntityKind,
    summary: raw.summary,
    relationshipCount: raw.relationship_count,
  };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function buildMimirHttpAdapter(client: ApiClient): IMimirService {
  return {
    mounts: {
      async listMounts(): Promise<Mount[]> {
        const raw = await client.get<RawMount[]>('/mounts');
        return raw.map(toMount);
      },
    },

    pages: {
      async getStats(): Promise<MimirStats> {
        const raw = await client.get<RawStats>('/stats');
        return {
          pageCount: raw.page_count,
          categories: raw.categories,
          healthy: raw.healthy,
        };
      },

      async listPages(options): Promise<PageMeta[]> {
        const params = new URLSearchParams();
        if (options?.mountName) params.set('mount', options.mountName);
        if (options?.category) params.set('category', options.category);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const raw = await client.get<RawPageMeta[]>(`/pages${qs}`);
        return raw.map(toPageMeta);
      },

      async getPage(path: string, mountName?: string): Promise<Page | null> {
        const params = new URLSearchParams({ path });
        if (mountName) params.set('mount', mountName);
        const raw = await client.get<RawPage | null>(`/page?${params.toString()}`);
        if (!raw) return null;
        return toPage(raw);
      },

      async upsertPage(path: string, content: string, mountName?: string): Promise<void> {
        const body: Record<string, string> = { path, content };
        if (mountName) body['mount'] = mountName;
        await client.put<void>('/page', body);
      },

      async search(query: string, mode: SearchMode = 'hybrid'): Promise<SearchResult[]> {
        const raw = await client.get<RawSearchResult[]>(
          `/search?q=${encodeURIComponent(query)}&mode=${mode}`,
        );
        return raw.map((r) => ({
          path: r.path,
          title: r.title,
          summary: r.summary,
          category: r.category,
          type: r.type as SearchResult['type'],
          confidence: r.confidence as SearchResult['confidence'],
        }));
      },

      async getGraph(options): Promise<MimirGraph> {
        const qs = options?.mountName
          ? `?mount=${encodeURIComponent(options.mountName)}`
          : '';
        const raw = await client.get<RawGraph>(`/graph${qs}`);
        return toGraph(raw);
      },

      async listEntities(options): Promise<EntityMeta[]> {
        const qs = options?.kind ? `?kind=${encodeURIComponent(options.kind)}` : '';
        const raw = await client.get<RawEntityMeta[]>(`/entities${qs}`);
        return raw.map(toEntityMeta);
      },
    },

    embeddings: {
      async semanticSearch(
        query: string,
        topK = 10,
        mountName?: string,
      ): Promise<EmbeddingSearchResult[]> {
        const params = new URLSearchParams({ q: query, top_k: String(topK) });
        if (mountName) params.set('mount', mountName);
        const raw = await client.get<RawEmbeddingResult[]>(
          `/embeddings/search?${params.toString()}`,
        );
        return raw.map(toEmbeddingResult);
      },
    },

    lint: {
      async getLintReport(mountName?: string): Promise<LintReport> {
        const qs = mountName ? `?mount=${encodeURIComponent(mountName)}` : '';
        const raw = await client.get<RawLintReport>(`/lint${qs}`);
        return toLintReport(raw);
      },

      async runAutoFix(issueIds?: string[]): Promise<LintReport> {
        const body = issueIds ? { issue_ids: issueIds } : {};
        const raw = await client.post<RawLintReport>('/lint/fix', body);
        return toLintReport(raw);
      },

      async getDreamCycles(limit = 20): Promise<DreamCycle[]> {
        const raw = await client.get<RawDreamCycle[]>(`/dreams?limit=${limit}`);
        return raw.map(toDreamCycle);
      },
    },
  };
}
