import type { Mount } from '@niuulabs/domain';
import type { IMimirService } from '../ports';
import type { PageMeta, Page, SearchResult } from '../domain/page';
import type { LintIssue, LintReport, DreamCycle } from '../domain/lint';
import type { MimirStats, MimirGraph } from '../domain/api-types';
import type { EmbeddingSearchResult } from '../ports/IEmbeddingStore';
import type { EntityMeta } from '../domain/entity';
import type { WriteRoutingRule } from '../domain/routing';
import type { RavnBinding } from '../domain/ravn-binding';
import { tallySeverity } from '../domain/lint';
import { toPageMeta } from '../domain/page';

// ---------------------------------------------------------------------------
// Seed data — mounts
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

// ---------------------------------------------------------------------------
// Seed data — topic / directive pages
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Seed data — entity pages
// ---------------------------------------------------------------------------

const MOCK_ENTITY_PAGES: Page[] = [
  {
    path: '/entities/niuulabs',
    title: 'Niuu Labs',
    summary: 'The organisation behind the Niuu platform.',
    category: 'org',
    type: 'entity',
    entityType: 'org',
    confidence: 'high',
    mounts: ['shared'],
    updatedAt: '2026-04-18T08:00:00Z',
    updatedBy: 'ravn-fjolnir',
    sourceIds: ['src-001'],
    related: ['/entities/tyr', '/entities/volundr', '/entities/mimir'],
    size: 800,
    zones: [
      {
        kind: 'relationships',
        items: [
          { slug: '/entities/tyr', note: 'builds' },
          { slug: '/entities/volundr', note: 'builds' },
          { slug: '/entities/mimir', note: 'builds' },
        ],
      },
    ],
  },
  {
    path: '/entities/hexagonal-arch',
    title: 'Hexagonal Architecture',
    summary: 'Software architecture pattern separating business logic from infrastructure via ports and adapters.',
    category: 'concept',
    type: 'entity',
    entityType: 'concept',
    confidence: 'high',
    mounts: ['shared', 'local'],
    updatedAt: '2026-04-17T12:00:00Z',
    updatedBy: 'ravn-skald',
    sourceIds: ['src-002'],
    related: ['/arch/overview', '/entities/asyncpg'],
    size: 600,
    zones: [
      {
        kind: 'key-facts',
        items: [
          'Business logic depends on ports (interfaces), never on adapters',
          'Adapters implement ports and can be swapped without changing business logic',
        ],
      },
    ],
  },
  {
    path: '/entities/tyr',
    title: 'Tyr',
    summary: 'The autonomous dispatcher module of the Niuu platform.',
    category: 'component',
    type: 'entity',
    entityType: 'component',
    confidence: 'high',
    mounts: ['local', 'shared'],
    updatedAt: '2026-04-16T10:00:00Z',
    updatedBy: 'ravn-fjolnir',
    sourceIds: ['src-006'],
    related: ['/entities/niuulabs', '/arch/overview'],
    size: 900,
    zones: [
      {
        kind: 'relationships',
        items: [{ slug: '/entities/niuulabs', note: 'maintained by' }],
      },
    ],
  },
  {
    path: '/entities/asyncpg',
    title: 'asyncpg',
    summary: 'High-performance async PostgreSQL driver for Python.',
    category: 'technology',
    type: 'entity',
    entityType: 'technology',
    confidence: 'medium',
    mounts: ['shared'],
    updatedAt: '2026-04-15T09:00:00Z',
    updatedBy: 'ravn-skald',
    sourceIds: ['src-003'],
    related: ['/api/overview', '/entities/hexagonal-arch'],
    size: 450,
    zones: [],
  },
];

const ALL_PAGES = [...MOCK_PAGES, ...MOCK_ENTITY_PAGES];

// ---------------------------------------------------------------------------
// Seed data — graph
// ---------------------------------------------------------------------------

const MOCK_GRAPH: MimirGraph = {
  nodes: ALL_PAGES.map((p) => ({
    id: p.path,
    title: p.title,
    category: p.category,
  })),
  edges: [
    { source: '/arch/overview', target: '/api/overview' },
    { source: '/infra/k8s', target: '/arch/overview' },
    { source: '/arch/overview', target: '/entities/hexagonal-arch' },
    { source: '/entities/niuulabs', target: '/entities/tyr' },
    { source: '/entities/tyr', target: '/arch/overview' },
    { source: '/api/overview', target: '/entities/asyncpg' },
    { source: '/entities/hexagonal-arch', target: '/entities/asyncpg' },
  ],
};

// ---------------------------------------------------------------------------
// Seed data — lint
// ---------------------------------------------------------------------------

const INITIAL_LINT_ISSUES: LintIssue[] = [
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
  {
    id: 'lint-004',
    rule: 'L02',
    severity: 'warn',
    page: '/infra/k8s',
    mount: 'platform',
    autoFix: true,
    message: 'Stale page — source updated 3 days ago but page not recompiled',
  },
  {
    id: 'lint-005',
    rule: 'L11',
    severity: 'error',
    page: '/arch/overview',
    mount: 'shared',
    assignee: 'ravn-fjolnir',
    autoFix: true,
    message: 'Stale mount index — index out of sync with page store',
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
  {
    id: 'dream-003',
    timestamp: '2026-04-17T03:00:00Z',
    ravn: 'ravn-skald',
    mounts: ['platform'],
    pagesUpdated: 6,
    entitiesCreated: 1,
    lintFixes: 0,
    durationMs: 28000,
  },
  {
    id: 'dream-004',
    timestamp: '2026-04-16T03:00:00Z',
    ravn: 'ravn-fjolnir',
    mounts: ['local', 'shared', 'platform'],
    pagesUpdated: 22,
    entitiesCreated: 8,
    lintFixes: 5,
    durationMs: 91000,
  },
];

// ---------------------------------------------------------------------------
// Seed data — write-routing rules
// ---------------------------------------------------------------------------

const INITIAL_ROUTING_RULES: WriteRoutingRule[] = [
  {
    id: 'route-001',
    prefix: '/infra',
    mountName: 'platform',
    priority: 5,
    active: true,
    desc: 'Infrastructure pages → platform mount',
  },
  {
    id: 'route-002',
    prefix: '/api',
    mountName: 'shared',
    priority: 10,
    active: true,
    desc: 'API docs → shared mount',
  },
  {
    id: 'route-003',
    prefix: '/entities',
    mountName: 'shared',
    priority: 15,
    active: true,
    desc: 'Entity pages → shared mount',
  },
  {
    id: 'route-004',
    prefix: '/',
    mountName: 'local',
    priority: 99,
    active: true,
    desc: 'Catch-all → local mount',
  },
];

// ---------------------------------------------------------------------------
// Seed data — ravn bindings
// ---------------------------------------------------------------------------

const MOCK_RAVN_BINDINGS: RavnBinding[] = [
  {
    ravnId: 'ravn-fjolnir',
    ravnRune: 'ᚠ',
    role: 'index',
    state: 'active',
    mountNames: ['local', 'shared', 'platform'],
    writeMount: 'local',
    lastDream: MOCK_DREAM_CYCLES[0] ?? null,
  },
  {
    ravnId: 'ravn-skald',
    ravnRune: 'ᛋ',
    role: 'build',
    state: 'idle',
    mountNames: ['shared', 'platform'],
    writeMount: 'shared',
    lastDream: MOCK_DREAM_CYCLES[2] ?? null,
  },
  {
    ravnId: 'ravn-galdra',
    ravnRune: 'ᚷ',
    role: 'verify',
    state: 'offline',
    mountNames: ['shared'],
    writeMount: 'shared',
    lastDream: null,
  },
];

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMimirMockAdapter(): IMimirService {
  // Mutable copies for write operations
  let lintIssues = [...INITIAL_LINT_ISSUES];
  let routingRules = [...INITIAL_ROUTING_RULES];

  return {
    mounts: {
      async listMounts(): Promise<Mount[]> {
        return MOCK_MOUNTS;
      },

      async listRoutingRules(): Promise<WriteRoutingRule[]> {
        return [...routingRules].sort((a, b) => a.priority - b.priority);
      },

      async upsertRoutingRule(rule: WriteRoutingRule): Promise<WriteRoutingRule> {
        const idx = routingRules.findIndex((r) => r.id === rule.id);
        if (idx >= 0) {
          routingRules[idx] = rule;
        } else {
          routingRules = [...routingRules, rule];
        }
        return rule;
      },

      async deleteRoutingRule(id: string): Promise<void> {
        routingRules = routingRules.filter((r) => r.id !== id);
      },

      async listRavnBindings(): Promise<RavnBinding[]> {
        return MOCK_RAVN_BINDINGS;
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
        return ALL_PAGES.find((p) => p.path === path) ?? null;
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

      async getGraph(options): Promise<MimirGraph> {
        if (!options?.mountName) {
          return MOCK_GRAPH;
        }
        const mountPages = new Set(
          ALL_PAGES.filter((p) => p.mounts.includes(options.mountName!)).map((p) => p.path),
        );
        return {
          nodes: MOCK_GRAPH.nodes.filter((n) => mountPages.has(n.id)),
          edges: MOCK_GRAPH.edges.filter(
            (e) => mountPages.has(e.source) && mountPages.has(e.target),
          ),
        };
      },

      async listEntities(options): Promise<EntityMeta[]> {
        let entities = MOCK_ENTITY_PAGES;
        if (options?.kind) {
          entities = entities.filter((p) => p.entityType === options.kind);
        }
        return entities.map((p) => ({
          path: p.path,
          title: p.title,
          entityKind: (p.entityType ?? 'concept') as EntityMeta['entityKind'],
          summary: p.summary,
          relationshipCount:
            p.zones
              ?.filter((z) => z.kind === 'relationships')
              .flatMap((z) => (z.kind === 'relationships' ? z.items : []))
              .length ?? 0,
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
      async getLintReport(mountName?: string): Promise<LintReport> {
        const issues = mountName
          ? lintIssues.filter((i) => i.mount === mountName)
          : lintIssues;
        return {
          issues,
          pagesChecked: MOCK_PAGES.length,
          summary: tallySeverity(issues),
        };
      },

      async runAutoFix(issueIds?: string[]): Promise<LintReport> {
        if (issueIds) {
          lintIssues = lintIssues.filter((i) => !issueIds.includes(i.id) || !i.autoFix);
        } else {
          lintIssues = lintIssues.filter((i) => !i.autoFix);
        }
        return {
          issues: lintIssues,
          pagesChecked: MOCK_PAGES.length,
          summary: tallySeverity(lintIssues),
        };
      },

      async reassignIssues(issueIds: string[], assignee: string): Promise<LintReport> {
        lintIssues = lintIssues.map((i) =>
          issueIds.includes(i.id) ? { ...i, assignee } : i,
        );
        return {
          issues: lintIssues,
          pagesChecked: MOCK_PAGES.length,
          summary: tallySeverity(lintIssues),
        };
      },

      async getDreamCycles(limit = 20): Promise<DreamCycle[]> {
        return MOCK_DREAM_CYCLES.slice(0, limit);
      },
    },
  };
}
