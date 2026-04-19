import type { Mount } from '@niuulabs/domain';
import type { IMimirService } from '../ports';
import type { PageMeta, Page, SearchResult } from '../domain/page';
import type { LintIssue, LintReport, DreamCycle } from '../domain/lint';
import type { MimirStats } from '../domain/api-types';
import type { EmbeddingSearchResult } from '../ports/IEmbeddingStore';
import { tallySeverity } from '../domain/lint';
import { toPageMeta } from '../domain/page';

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const MOCK_MOUNTS: Mount[] = [
  {
    name: 'local',
    role: 'local',
    host: 'localhost',
    url: 'http://localhost:7700',
    priority: 1,
    categories: null,
    status: 'healthy',
    pages: 42,
    sources: 18,
    lintIssues: 3,
    lastWrite: '2026-04-18T14:22:00Z',
    embedding: 'all-minilm-l6-v2',
    sizeKb: 512,
    desc: "Operator's local knowledge store",
  },
  {
    name: 'shared',
    role: 'shared',
    host: 'kb.niuu.world',
    url: 'https://kb.niuu.world',
    priority: 5,
    categories: null,
    status: 'healthy',
    pages: 210,
    sources: 87,
    lintIssues: 7,
    lastWrite: '2026-04-19T09:00:00Z',
    embedding: 'all-mpnet-base-v2',
    sizeKb: 4096,
    desc: 'Realm-wide shared knowledge base',
  },
  {
    name: 'platform',
    role: 'domain',
    host: 'platform-kb.niuu.world',
    url: 'https://platform-kb.niuu.world',
    priority: 3,
    categories: ['infra', 'api', 'arch'],
    status: 'degraded',
    pages: 65,
    sources: 31,
    lintIssues: 12,
    lastWrite: '2026-04-17T16:45:00Z',
    embedding: 'all-minilm-l6-v2',
    sizeKb: 1024,
    desc: 'Platform-scoped domain knowledge (infra / api / arch)',
  },
];

const MOCK_PAGES: Page[] = [
  {
    path: '/arch/overview',
    title: 'Architecture Overview',
    summary: 'High-level view of the Niuu platform architecture.',
    category: 'arch',
    type: 'topic',
    confidence: 'high',
    mounts: ['local', 'shared'],
    updatedAt: '2026-04-18T10:00:00Z',
    updatedBy: 'ravn-fjolnir',
    sourceIds: ['src-001', 'src-002'],
    related: ['/arch/hexagonal', '/api/overview'],
    size: 3200,
    zones: [
      {
        kind: 'key-facts',
        items: [
          'Hexagonal architecture with ports and adapters',
          'Six cognitive regions (Sköll, Hati, Sága, Móði, Váli, Víðarr)',
          'Tyr, Volundr, and Niuu are separate modules',
        ],
      },
      {
        kind: 'assessment',
        text: 'Architecture is sound and well-documented. Consider extracting shared domain types.',
      },
    ],
  },
  {
    path: '/api/overview',
    title: 'API Design Guidelines',
    summary: 'Standards and conventions for Niuu REST APIs.',
    category: 'api',
    type: 'directive',
    confidence: 'high',
    mounts: ['shared'],
    updatedAt: '2026-04-15T09:30:00Z',
    updatedBy: 'ravn-skald',
    sourceIds: ['src-003'],
    related: ['/arch/overview'],
    size: 2100,
    zones: [
      {
        kind: 'key-facts',
        items: [
          'Raw SQL with asyncpg — no ORM',
          'Parameterised queries only',
          'Hexagonal adapter pattern for all infrastructure',
        ],
      },
      {
        kind: 'timeline',
        items: [
          { date: '2026-01-10', note: 'Initial guidelines published', source: 'src-003' },
          { date: '2026-03-20', note: 'Added asyncpg section', source: 'src-003' },
        ],
      },
    ],
  },
  {
    path: '/infra/k8s',
    title: 'Kubernetes Deployment',
    summary: 'Kubernetes-native deployment patterns for the Niuu platform.',
    category: 'infra',
    type: 'topic',
    confidence: 'medium',
    mounts: ['platform'],
    updatedAt: '2026-04-10T14:00:00Z',
    updatedBy: 'ravn-fjolnir',
    sourceIds: ['src-004', 'src-005'],
    related: ['/infra/envoy', '/arch/overview'],
    size: 4500,
    zones: [
      {
        kind: 'key-facts',
        items: [
          'Uses `migrate` for schema migrations (not Alembic)',
          'Envoy as API gateway with OIDC',
          'Services exposed as ClusterIP internally',
        ],
      },
    ],
  },
];

const MOCK_LINT_ISSUES: LintIssue[] = [
  {
    id: 'lint-001',
    rule: 'L05',
    severity: 'error',
    page: '/arch/hexagonal',
    mount: 'local',
    autoFix: false,
    message: 'Broken wikilink: [[ports/overview]] — target page does not exist',
  },
  {
    id: 'lint-002',
    rule: 'L07',
    severity: 'warn',
    page: '/infra/legacy-proxy',
    mount: 'platform',
    assignee: 'ravn-skald',
    autoFix: true,
    message: 'Orphan page — no inbound links from any other page',
  },
  {
    id: 'lint-003',
    rule: 'L12',
    severity: 'info',
    page: '/api/overview',
    mount: 'shared',
    autoFix: true,
    message: 'Missing required frontmatter field: `owner`',
  },
];

const MOCK_DREAM_CYCLES: DreamCycle[] = [
  {
    id: 'dream-001',
    timestamp: '2026-04-19T03:00:00Z',
    ravn: 'ravn-fjolnir',
    mounts: ['local', 'shared'],
    pagesUpdated: 8,
    entitiesCreated: 2,
    lintFixes: 1,
    durationMs: 42000,
  },
  {
    id: 'dream-002',
    timestamp: '2026-04-18T03:00:00Z',
    ravn: 'ravn-fjolnir',
    mounts: ['shared', 'platform'],
    pagesUpdated: 14,
    entitiesCreated: 5,
    lintFixes: 3,
    durationMs: 67000,
  },
];

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMimirMockAdapter(): IMimirService {
  return {
    mounts: {
      async listMounts(): Promise<Mount[]> {
        return MOCK_MOUNTS;
      },
    },

    pages: {
      async getStats(): Promise<MimirStats> {
        const categories = [...new Set(MOCK_PAGES.map((p) => p.category))];
        return {
          pageCount: MOCK_PAGES.length,
          categories,
          healthy: MOCK_MOUNTS.every((m) => m.status !== 'down'),
        };
      },

      async listPages(options): Promise<PageMeta[]> {
        let pages = MOCK_PAGES;
        if (options?.mountName) {
          pages = pages.filter((p) => p.mounts.includes(options.mountName!));
        }
        if (options?.category) {
          pages = pages.filter((p) => p.category === options.category);
        }
        return pages.map(toPageMeta);
      },

      async getPage(path: string): Promise<Page | null> {
        return MOCK_PAGES.find((p) => p.path === path) ?? null;
      },

      async upsertPage(): Promise<void> {
        // no-op in mock
      },

      async search(query: string): Promise<SearchResult[]> {
        const q = query.toLowerCase();
        return MOCK_PAGES.filter(
          (p) => p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q),
        ).map((p) => ({
          path: p.path,
          title: p.title,
          summary: p.summary,
          category: p.category,
          type: p.type,
          confidence: p.confidence,
        }));
      },
    },

    embeddings: {
      async semanticSearch(_query: string, topK = 10): Promise<EmbeddingSearchResult[]> {
        return MOCK_PAGES.slice(0, topK).map((p, i) => ({
          path: p.path,
          title: p.title,
          summary: p.summary,
          score: Math.max(0.5, 0.95 - i * 0.15),
          mountName: p.mounts[0] ?? 'local',
        }));
      },
    },

    lint: {
      async getLintReport(): Promise<LintReport> {
        return {
          issues: MOCK_LINT_ISSUES,
          pagesChecked: MOCK_PAGES.length,
          summary: tallySeverity(MOCK_LINT_ISSUES),
        };
      },

      async runAutoFix(issueIds?: string[]): Promise<LintReport> {
        const remaining = issueIds
          ? MOCK_LINT_ISSUES.filter((i) => !issueIds.includes(i.id) || !i.autoFix)
          : MOCK_LINT_ISSUES.filter((i) => !i.autoFix);
        return {
          issues: remaining,
          pagesChecked: MOCK_PAGES.length,
          summary: tallySeverity(remaining),
        };
      },

      async getDreamCycles(limit = 20): Promise<DreamCycle[]> {
        return MOCK_DREAM_CYCLES.slice(0, limit);
      },
    },
  };
}
