/**
 * Mock adapter for IMimirService.
 *
 * Returns seeded in-memory data for development, Storybook, and unit tests.
 * Simulates network latency with a configurable delay.
 */

import type { IMimirService } from '../ports/IMimirService';
import type {
  Mount,
  MimirStats,
  MimirPageMeta,
  Page,
  MimirSearchResult,
  MimirLogEntry,
  LintReport,
  LintIssue,
  MimirGraph,
  IngestRequest,
  IngestResponse,
  DreamCycle,
  Source,
} from '../domain/types';

const MOCK_DELAY_MS = 120;

function delay(): Promise<void> {
  return new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const MOUNTS: Mount[] = [
  {
    name: 'local',
    role: 'local',
    host: 'localhost',
    url: 'http://localhost:4200',
    priority: 1,
    categories: null,
    status: 'healthy',
    pages: 47,
    sources: 112,
    lintIssues: 3,
    lastWrite: '2026-04-18T22:10:00Z',
    embedding: 'all-MiniLM-L6-v2',
    sizeKb: 2048,
    desc: 'Local operator mount — personal notes and drafts',
  },
  {
    name: 'shared',
    role: 'shared',
    host: 'mimir.niuu.realm',
    url: 'https://mimir.niuu.realm',
    priority: 2,
    categories: null,
    status: 'healthy',
    pages: 341,
    sources: 892,
    lintIssues: 12,
    lastWrite: '2026-04-19T01:00:00Z',
    embedding: 'all-mpnet-base-v2',
    sizeKb: 18432,
    desc: 'Realm-wide shared knowledge base',
  },
  {
    name: 'engineering',
    role: 'domain',
    host: 'mimir.eng.niuu.realm',
    url: 'https://mimir.eng.niuu.realm',
    priority: 3,
    categories: ['infra', 'api', 'services', 'architecture'],
    status: 'degraded',
    pages: 128,
    sources: 304,
    lintIssues: 7,
    lastWrite: '2026-04-17T15:30:00Z',
    embedding: 'all-MiniLM-L6-v2',
    sizeKb: 7168,
    desc: 'Engineering domain mount — infra and API knowledge',
  },
];

const PAGE_METAS: MimirPageMeta[] = [
  {
    path: '/arch/overview',
    title: 'Architecture Overview',
    summary: 'High-level overview of the Niuu platform architecture.',
    category: 'architecture',
    updatedAt: '2026-04-15T10:00:00Z',
    sourceIds: ['src-001', 'src-002'],
  },
  {
    path: '/arch/api-design',
    title: 'API Design Guidelines',
    summary: 'REST and gRPC conventions used across all Niuu services.',
    category: 'api',
    updatedAt: '2026-04-10T09:00:00Z',
    sourceIds: ['src-003'],
  },
  {
    path: '/infra/kubernetes',
    title: 'Kubernetes Deployment',
    summary: 'Cluster topology, namespaces, and Helm chart conventions.',
    category: 'infra',
    updatedAt: '2026-04-12T14:00:00Z',
    sourceIds: ['src-004', 'src-005'],
  },
  {
    path: '/entities/niuulabs',
    title: 'Niuulabs',
    summary: 'The organisation behind the Niuu platform.',
    category: 'entities',
    updatedAt: '2026-04-01T08:00:00Z',
    sourceIds: ['src-006'],
  },
  {
    path: '/decisions/adr-001',
    title: 'ADR-001: Hexagonal Architecture',
    summary: 'Decision record for adopting hexagonal architecture.',
    category: 'decisions',
    updatedAt: '2026-03-20T16:00:00Z',
    sourceIds: [],
  },
];

const PAGES: Page[] = [
  {
    path: '/arch/overview',
    title: 'Architecture Overview',
    type: 'topic',
    confidence: 'high',
    category: 'architecture',
    summary: 'High-level overview of the Niuu platform architecture.',
    mounts: ['shared', 'engineering'],
    updatedAt: '2026-04-15T10:00:00Z',
    updatedBy: 'ravn-vidarr',
    sourceIds: ['src-001', 'src-002'],
    related: ['/arch/api-design', '/infra/kubernetes'],
    size: 4096,
    zones: [
      {
        kind: 'key-facts',
        items: [
          'Hexagonal architecture with ports and adapters',
          'Six cognitive regions: Sköll, Hati, Sága, Móði, Váli, Víðarr',
          'nng synapses for inter-region communication',
          'No ORM — raw SQL with asyncpg',
        ],
      },
      {
        kind: 'relationships',
        items: [
          { slug: '/arch/api-design', note: 'REST and gRPC API conventions' },
          { slug: '/infra/kubernetes', note: 'Deployment infrastructure' },
        ],
      },
      {
        kind: 'assessment',
        text: 'Architecture is stable and well-documented. Hexagonal boundaries are consistently enforced across all modules.',
      },
      {
        kind: 'timeline',
        entries: [
          {
            date: '2026-01-10',
            note: 'Initial architecture document created',
            source: 'src-001',
          },
          {
            date: '2026-04-15',
            note: 'Updated after Mimir integration',
            source: 'src-002',
          },
        ],
      },
    ],
  },
  {
    path: '/entities/niuulabs',
    title: 'Niuulabs',
    type: 'entity',
    confidence: 'high',
    entityType: 'org',
    category: 'entities',
    summary: 'The organisation behind the Niuu platform.',
    mounts: ['shared'],
    updatedAt: '2026-04-01T08:00:00Z',
    updatedBy: 'ravn-saga',
    sourceIds: ['src-006'],
    related: [],
    size: 1024,
    zones: [
      {
        kind: 'key-facts',
        items: ['Builds the Niuu AI agent platform', 'Hexagonal, composable design philosophy'],
      },
      { kind: 'relationships', items: [] },
      { kind: 'assessment', text: 'Well-known organisation in the platform space.' },
      { kind: 'timeline', entries: [] },
    ],
  },
];

const SOURCES: Source[] = [
  {
    id: 'src-001',
    origin: 'file',
    path: '/docs/arch/overview.md',
    ingestedAt: '2026-01-10T12:00:00Z',
    ingestAgent: 'ravn-skoll',
    compiledInto: ['/arch/overview'],
    content: '# Architecture Overview\n\nThe Niuu platform uses hexagonal architecture...',
  },
  {
    id: 'src-002',
    origin: 'chat',
    ingestedAt: '2026-04-15T09:45:00Z',
    ingestAgent: 'ravn-vidarr',
    compiledInto: ['/arch/overview'],
  },
  {
    id: 'src-003',
    origin: 'web',
    url: 'https://wiki.niuu.world/api-design',
    ingestedAt: '2026-04-10T08:30:00Z',
    ingestAgent: 'ravn-hati',
    compiledInto: ['/arch/api-design'],
  },
  {
    id: 'src-004',
    origin: 'file',
    path: '/infra/k8s-readme.md',
    ingestedAt: '2026-04-12T13:00:00Z',
    ingestAgent: 'ravn-skoll',
    compiledInto: ['/infra/kubernetes'],
  },
  {
    id: 'src-005',
    origin: 'file',
    path: '/infra/helm-conventions.md',
    ingestedAt: '2026-04-12T13:30:00Z',
    ingestAgent: 'ravn-skoll',
    compiledInto: ['/infra/kubernetes'],
  },
];

const LINT_ISSUES: LintIssue[] = [
  {
    id: 'li-001',
    rule: 'L05',
    severity: 'warning',
    message: 'Broken wikilink [[/services/tyr]] — page not found on any mount',
    pagePath: '/arch/overview',
    mount: 'shared',
    autoFix: false,
    suggestedFix: 'Remove the wikilink or create the target page',
  },
  {
    id: 'li-002',
    rule: 'L07',
    severity: 'info',
    message: 'Orphan page — no inbound links from any other page',
    pagePath: '/decisions/adr-001',
    mount: 'shared',
    autoFix: false,
  },
  {
    id: 'li-003',
    rule: 'L12',
    severity: 'error',
    message: 'Invalid frontmatter: missing required field "category"',
    pagePath: '/infra/kubernetes',
    mount: 'engineering',
    autoFix: true,
    suggestedFix: 'Add category: infra to frontmatter',
  },
  {
    id: 'li-004',
    rule: 'L02',
    severity: 'warning',
    message: 'Source src-003 has not been re-ingested in > 30 days',
    pagePath: '/arch/api-design',
    mount: 'engineering',
    assignee: 'ravn-hati',
    autoFix: false,
  },
  {
    id: 'li-005',
    rule: 'L11',
    severity: 'info',
    message: 'Stale index: /entities category index last rebuilt 14 days ago',
    pagePath: '/entities/niuulabs',
    mount: 'shared',
    autoFix: true,
    suggestedFix: 'Rebuild category index',
  },
];

const LINT_REPORT: LintReport = {
  issues: LINT_ISSUES,
  pagesChecked: 47,
  issuesFound: true,
  summary: { error: 1, warning: 2, info: 2 },
};

const DREAM_CYCLES: DreamCycle[] = [
  {
    id: 'dc-001',
    ravnId: 'ravn-vidarr',
    mounts: ['shared'],
    startedAt: '2026-04-19T02:00:00Z',
    endedAt: '2026-04-19T02:04:12Z',
    durationMs: 252000,
    summary: { pagesUpdated: 8, entitiesCreated: 2, lintFixes: 1 },
    changelog: [
      'Updated /arch/overview with new ravn binding section',
      'Created entity /entities/fjolnir (person)',
      'Created entity /entities/mimir-mount (concept)',
      'Auto-fixed L11 stale index on /entities',
    ],
  },
  {
    id: 'dc-002',
    ravnId: 'ravn-saga',
    mounts: ['shared', 'engineering'],
    startedAt: '2026-04-18T14:00:00Z',
    endedAt: '2026-04-18T14:07:33Z',
    durationMs: 453000,
    summary: { pagesUpdated: 14, entitiesCreated: 0, lintFixes: 3 },
    changelog: [
      'Refreshed 14 pages in engineering mount',
      'Applied 3 auto-fixes across lint queue',
    ],
  },
  {
    id: 'dc-003',
    ravnId: 'ravn-vidarr',
    mounts: ['local'],
    startedAt: '2026-04-17T22:00:00Z',
    endedAt: '2026-04-17T22:01:45Z',
    durationMs: 105000,
    summary: { pagesUpdated: 3, entitiesCreated: 0, lintFixes: 0 },
    changelog: ['Refreshed 3 local pages from recent chat ingests'],
  },
];

const LOG_ENTRY: MimirLogEntry = {
  raw: '[2026-04-19T02:04:12Z] dream-cycle dc-001 completed\n[2026-04-19T01:00:00Z] ingest src-002 complete',
  entries: [
    '[2026-04-19T02:04:12Z] dream-cycle dc-001 completed',
    '[2026-04-19T01:00:00Z] ingest src-002 complete',
  ],
};

const GRAPH: MimirGraph = {
  nodes: PAGE_METAS.map((p) => ({
    id: p.path,
    title: p.title,
    category: p.category,
  })),
  edges: [
    { source: '/arch/overview', target: '/arch/api-design' },
    { source: '/arch/overview', target: '/infra/kubernetes' },
    { source: '/decisions/adr-001', target: '/arch/overview' },
  ],
};

const STATS: MimirStats = {
  pageCount: 516,
  categories: ['architecture', 'api', 'infra', 'entities', 'decisions'],
  healthy: true,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Mimir service backed by in-memory seed data.
 * Suitable for development, Storybook, and unit tests.
 */
export function createMockMimirService(): IMimirService {
  return {
    // --- IMountAdapter ---
    async listMounts(): Promise<Mount[]> {
      await delay();
      return MOUNTS;
    },

    async getStats(): Promise<MimirStats> {
      await delay();
      return STATS;
    },

    // --- IPageStore ---
    async listPages(opts?) {
      await delay();
      if (!opts?.category) return PAGE_METAS;
      return PAGE_METAS.filter((p) => p.category === opts.category);
    },

    async getPage(path: string): Promise<Page> {
      await delay();
      const page = PAGES.find((p) => p.path === path);
      if (page) return page;
      // Return a minimal page for unknown paths
      return {
        path,
        title: path.split('/').pop() ?? path,
        type: 'topic',
        confidence: 'medium',
        category: 'unknown',
        summary: '',
        mounts: ['local'],
        updatedAt: new Date().toISOString(),
        updatedBy: 'unknown',
        sourceIds: [],
        related: [],
        size: 0,
        zones: [],
      };
    },

    async upsertPage(_path: string, _content: string): Promise<void> {
      await delay();
    },

    // --- IEmbeddingStore ---
    async search(query: string, _opts?): Promise<MimirSearchResult[]> {
      await delay();
      const q = query.toLowerCase();
      return PAGE_METAS.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      ).map((p) => ({
        path: p.path,
        title: p.title,
        summary: p.summary,
        category: p.category,
      }));
    },

    async getGraph(): Promise<MimirGraph> {
      await delay();
      return GRAPH;
    },

    // --- ILintEngine ---
    async getLint(_mountName?: string): Promise<LintReport> {
      await delay();
      return LINT_REPORT;
    },

    async lintFix(_issueIds?: string[]): Promise<LintReport> {
      await delay();
      const fixable = LINT_ISSUES.filter((i) => !i.autoFix);
      return {
        issues: fixable,
        pagesChecked: LINT_REPORT.pagesChecked,
        issuesFound: fixable.length > 0,
        summary: {
          error: fixable.filter((i) => i.severity === 'error').length,
          warning: fixable.filter((i) => i.severity === 'warning').length,
          info: fixable.filter((i) => i.severity === 'info').length,
        },
      };
    },

    // --- additional ---
    async getLog(_n?: number): Promise<MimirLogEntry> {
      await delay();
      return LOG_ENTRY;
    },

    async ingest(request: IngestRequest): Promise<IngestResponse> {
      await delay();
      return {
        sourceId: `src-mock-${Date.now()}`,
        pagesUpdated: [`/ingest/${request.title.toLowerCase().replace(/\s+/g, '-')}`],
      };
    },

    async listDreamCycles(): Promise<DreamCycle[]> {
      await delay();
      return DREAM_CYCLES;
    },

    async listSources(_mountName?: string): Promise<Source[]> {
      await delay();
      return SOURCES;
    },
  };
}
