import { describe, it, expect, vi } from 'vitest';
import { buildMimirHttpAdapter } from './http';

function makeClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({ issues: [], pages_checked: 0 }),
    put: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe('buildMimirHttpAdapter', () => {
  describe('mounts.listMounts', () => {
    it('calls GET /mounts', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).mounts.listMounts();
      expect(client.get).toHaveBeenCalledWith('/mounts');
    });

    it('maps raw mount fields to domain Mount', async () => {
      const rawMount = {
        name: 'local',
        role: 'local',
        host: 'localhost',
        url: 'http://localhost:7700',
        priority: 1,
        categories: null,
        status: 'healthy',
        pages: 42,
        sources: 18,
        lint_issues: 3,
        last_write: '2026-04-18T14:22:00Z',
        embedding: 'all-minilm-l6-v2',
        size_kb: 512,
        desc: 'Local mount',
      };
      const client = makeClient({ get: vi.fn().mockResolvedValue([rawMount]) });
      const mounts = await buildMimirHttpAdapter(client).mounts.listMounts();
      expect(mounts[0]).toMatchObject({
        name: 'local',
        role: 'local',
        pages: 42,
        lintIssues: 3,
        lastWrite: '2026-04-18T14:22:00Z',
        sizeKb: 512,
      });
    });
  });

  describe('pages.getStats', () => {
    it('calls GET /stats', async () => {
      const client = makeClient({
        get: vi.fn().mockResolvedValue({ page_count: 5, categories: [], healthy: true }),
      });
      await buildMimirHttpAdapter(client).pages.getStats();
      expect(client.get).toHaveBeenCalledWith('/stats');
    });

    it('maps snake_case to camelCase', async () => {
      const client = makeClient({
        get: vi.fn().mockResolvedValue({
          page_count: 10,
          categories: ['arch', 'api'],
          healthy: false,
        }),
      });
      const stats = await buildMimirHttpAdapter(client).pages.getStats();
      expect(stats.pageCount).toBe(10);
      expect(stats.categories).toEqual(['arch', 'api']);
      expect(stats.healthy).toBe(false);
    });
  });

  describe('pages.listPages', () => {
    it('calls GET /pages without query string when no options', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listPages();
      expect(client.get).toHaveBeenCalledWith('/pages');
    });

    it('appends mount and category query params', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listPages({ mountName: 'local', category: 'arch' });
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('mount=local');
      expect(call).toContain('category=arch');
    });
  });

  describe('pages.getPage', () => {
    it('calls GET /page with path param', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue(null) });
      await buildMimirHttpAdapter(client).pages.getPage('/arch/overview');
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/page');
      expect(call).toContain('path=%2Farch%2Foverview');
    });

    it('returns null when API returns null', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue(null) });
      const result = await buildMimirHttpAdapter(client).pages.getPage('/missing');
      expect(result).toBeNull();
    });
  });

  describe('pages.upsertPage', () => {
    it('calls PUT /page with path and content', async () => {
      const client = makeClient();
      await buildMimirHttpAdapter(client).pages.upsertPage('/test', '# Content');
      expect(client.put).toHaveBeenCalledWith('/page', { path: '/test', content: '# Content' });
    });
  });

  describe('pages.search', () => {
    it('calls GET /search with query and default mode', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.search('kubernetes');
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('q=kubernetes');
      expect(call).toContain('mode=hybrid');
    });

    it('respects explicit search mode', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.search('k8s', 'fts');
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('mode=fts');
    });
  });

  describe('embeddings.semanticSearch', () => {
    it('calls GET /embeddings/search with query and topK', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).embeddings.semanticSearch('arch', 5);
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/embeddings/search');
      expect(call).toContain('q=arch');
      expect(call).toContain('top_k=5');
    });

    it('maps raw embedding result to EmbeddingSearchResult', async () => {
      const raw = [{ path: '/a', title: 'A', summary: 'S', score: 0.9, mount_name: 'local' }];
      const client = makeClient({ get: vi.fn().mockResolvedValue(raw) });
      const results = await buildMimirHttpAdapter(client).embeddings.semanticSearch('q');
      expect(results[0]).toMatchObject({ path: '/a', score: 0.9, mountName: 'local' });
    });
  });

  describe('lint.getLintReport', () => {
    it('calls GET /lint', async () => {
      const client = makeClient({
        get: vi.fn().mockResolvedValue({ issues: [], pages_checked: 0 }),
      });
      await buildMimirHttpAdapter(client).lint.getLintReport();
      expect(client.get).toHaveBeenCalledWith('/lint');
    });

    it('maps raw lint issues with snake_case fields', async () => {
      const rawIssue = {
        id: 'lint-1',
        rule: 'L05',
        severity: 'error',
        page: '/a',
        mount: 'local',
        auto_fix: true,
        message: 'Broken link',
      };
      const client = makeClient({
        get: vi.fn().mockResolvedValue({ issues: [rawIssue], pages_checked: 5 }),
      });
      const report = await buildMimirHttpAdapter(client).lint.getLintReport();
      expect(report.issues[0]).toMatchObject({
        id: 'lint-1',
        rule: 'L05',
        autoFix: true,
      });
    });
  });

  describe('lint.runAutoFix', () => {
    it('calls POST /lint/fix with empty body when no ids', async () => {
      const client = makeClient();
      await buildMimirHttpAdapter(client).lint.runAutoFix();
      expect(client.post).toHaveBeenCalledWith('/lint/fix', {});
    });

    it('passes issue_ids when provided', async () => {
      const client = makeClient();
      await buildMimirHttpAdapter(client).lint.runAutoFix(['lint-1', 'lint-2']);
      expect(client.post).toHaveBeenCalledWith('/lint/fix', {
        issue_ids: ['lint-1', 'lint-2'],
      });
    });
  });

  describe('lint.getDreamCycles', () => {
    it('calls GET /dreams with limit', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).lint.getDreamCycles(5);
      expect(client.get).toHaveBeenCalledWith('/dreams?limit=5');
    });

    it('maps raw dream cycle fields', async () => {
      const raw = [
        {
          id: 'dream-1',
          timestamp: '2026-04-19T03:00:00Z',
          ravn: 'ravn-fjolnir',
          mounts: ['local'],
          pages_updated: 8,
          entities_created: 2,
          lint_fixes: 1,
          duration_ms: 42000,
        },
      ];
      const client = makeClient({ get: vi.fn().mockResolvedValue(raw) });
      const cycles = await buildMimirHttpAdapter(client).lint.getDreamCycles();
      expect(cycles[0]).toMatchObject({
        id: 'dream-1',
        pagesUpdated: 8,
        entitiesCreated: 2,
        lintFixes: 1,
        durationMs: 42000,
      });
    });
  });

  describe('pages.getGraph', () => {
    it('calls GET /graph without query string when no options', async () => {
      const rawGraph = { nodes: [], edges: [] };
      const client = makeClient({ get: vi.fn().mockResolvedValue(rawGraph) });
      await buildMimirHttpAdapter(client).pages.getGraph();
      expect(client.get).toHaveBeenCalledWith('/graph');
    });

    it('appends mount query param when mountName is provided', async () => {
      const rawGraph = { nodes: [], edges: [] };
      const client = makeClient({ get: vi.fn().mockResolvedValue(rawGraph) });
      await buildMimirHttpAdapter(client).pages.getGraph({ mountName: 'local' });
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/graph');
      expect(call).toContain('mount=local');
    });

    it('maps raw graph node and edge fields', async () => {
      const rawGraph = {
        nodes: [
          {
            id: '/arch/overview',
            title: 'Architecture Overview',
            category: 'arch',
            inbound_count: 2,
          },
        ],
        edges: [{ source: '/infra/k8s', target: '/arch/overview' }],
      };
      const client = makeClient({ get: vi.fn().mockResolvedValue(rawGraph) });
      const graph = await buildMimirHttpAdapter(client).pages.getGraph();
      expect(graph.nodes[0]).toMatchObject({
        id: '/arch/overview',
        title: 'Architecture Overview',
        category: 'arch',
        inboundCount: 2,
      });
      expect(graph.edges[0]).toMatchObject({ source: '/infra/k8s', target: '/arch/overview' });
    });
  });

  describe('mounts.getRecentWrites', () => {
    it('calls GET /mounts/recent-writes without limit when none specified', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).mounts.getRecentWrites();
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/mounts/recent-writes');
      expect(call).not.toContain('limit=');
    });

    it('passes explicit limit', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).mounts.getRecentWrites(5);
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('limit=5');
    });

    it('maps raw recent write fields', async () => {
      const raw = [
        {
          id: 'rw-1',
          timestamp: '2026-04-19T10:00:00Z',
          mount: 'local',
          page: '/arch/overview',
          ravn: 'ravn-fjolnir',
          kind: 'write',
          message: 'Updated architecture overview',
        },
      ];
      const client = makeClient({ get: vi.fn().mockResolvedValue(raw) });
      const writes = await buildMimirHttpAdapter(client).mounts.getRecentWrites();
      expect(writes[0]).toMatchObject({
        id: 'rw-1',
        mount: 'local',
        page: '/arch/overview',
        ravn: 'ravn-fjolnir',
        kind: 'write',
      });
    });
  });

  describe('pages.listSources', () => {
    it('calls GET /sources without query string when no options', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listSources();
      expect(client.get).toHaveBeenCalledWith('/sources');
    });

    it('appends origin_type and mount query params', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listSources({
        originType: 'web',
        mountName: 'local',
      });
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('origin_type=web');
      expect(call).toContain('mount=local');
    });
  });

  describe('pages.getPageSources', () => {
    it('calls GET /page/sources with encoded path', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.getPageSources('/arch/overview');
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/page/sources');
      expect(call).toContain('path=%2Farch%2Foverview');
    });
  });

  describe('pages.listEntities', () => {
    it('calls GET /entities without query string when no options', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listEntities();
      expect(client.get).toHaveBeenCalledWith('/entities');
    });

    it('appends kind query param when kind is provided', async () => {
      const client = makeClient({ get: vi.fn().mockResolvedValue([]) });
      await buildMimirHttpAdapter(client).pages.listEntities({ kind: 'org' });
      const call = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(call).toContain('/entities');
      expect(call).toContain('kind=org');
    });

    it('maps raw entity meta fields', async () => {
      const rawEntities = [
        {
          path: '/entities/niuulabs',
          title: 'Niuu Labs',
          entity_kind: 'org',
          summary: 'The organisation behind Niuu.',
          relationship_count: 3,
        },
      ];
      const client = makeClient({ get: vi.fn().mockResolvedValue(rawEntities) });
      const entities = await buildMimirHttpAdapter(client).pages.listEntities();
      expect(entities[0]).toMatchObject({
        path: '/entities/niuulabs',
        title: 'Niuu Labs',
        entityKind: 'org',
        summary: 'The organisation behind Niuu.',
        relationshipCount: 3,
      });
    });
  });
});
