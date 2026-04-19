/**
 * HTTP adapter tests.
 *
 * Adapted from web/src/modules/mimir/api/client.test.ts.
 * Instead of module-mocking createApiClient, we pass a mock ApiClient
 * directly to createHttpMimirService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHttpMimirService } from './http';
import type { ApiClient } from '@niuulabs/query';

function makeMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } satisfies ApiClient;
}

describe('HTTP Mimir service adapter', () => {
  let client: ReturnType<typeof makeMockClient>;
  let service: ReturnType<typeof createHttpMimirService>;

  beforeEach(() => {
    client = makeMockClient();
    service = createHttpMimirService(client);
    vi.clearAllMocks();
  });

  // --- getStats ---
  describe('getStats', () => {
    it('maps raw stats to domain model', async () => {
      client.get.mockResolvedValue({
        page_count: 42,
        categories: ['infra', 'api'],
        healthy: true,
      });

      const result = await service.getStats();

      expect(client.get).toHaveBeenCalledWith('/stats');
      expect(result).toEqual({
        pageCount: 42,
        categories: ['infra', 'api'],
        healthy: true,
      });
    });
  });

  // --- listPages ---
  describe('listPages', () => {
    it('lists all pages without category filter', async () => {
      client.get.mockResolvedValue([
        {
          path: '/arch/overview',
          title: 'Architecture Overview',
          summary: 'Main overview',
          category: 'infra',
          updated_at: '2026-04-01T10:00:00Z',
          source_ids: ['src-1'],
        },
      ]);

      const result = await service.listPages();

      expect(client.get).toHaveBeenCalledWith('/pages');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: '/arch/overview',
        title: 'Architecture Overview',
        summary: 'Main overview',
        category: 'infra',
        updatedAt: '2026-04-01T10:00:00Z',
        sourceIds: ['src-1'],
      });
    });

    it('filters pages by category', async () => {
      client.get.mockResolvedValue([]);

      await service.listPages({ category: 'infra' });

      expect(client.get).toHaveBeenCalledWith('/pages?category=infra');
    });

    it('defaults sourceIds to empty array when absent', async () => {
      client.get.mockResolvedValue([
        {
          path: '/test',
          title: 'Test',
          summary: 'Sum',
          category: 'cat',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]);

      const result = await service.listPages();
      expect(result[0]?.sourceIds).toEqual([]);
    });
  });

  // --- getPage ---
  describe('getPage', () => {
    it('maps a raw page to the Page domain type', async () => {
      client.get.mockResolvedValue({
        path: '/arch/api',
        title: 'API Design',
        summary: 'API guidelines',
        category: 'api',
        updated_at: '2026-03-15T12:00:00Z',
        type: 'topic',
        confidence: 'high',
        mounts: ['shared'],
        updated_by: 'ravn-vidarr',
        related: ['/arch/overview'],
        size: 2048,
      });

      const result = await service.getPage('/arch/api');

      expect(client.get).toHaveBeenCalledWith('/page?path=%2Farch%2Fapi');
      expect(result.path).toBe('/arch/api');
      expect(result.type).toBe('topic');
      expect(result.confidence).toBe('high');
      expect(result.mounts).toEqual(['shared']);
      expect(result.updatedBy).toBe('ravn-vidarr');
      expect(result.updatedAt).toBe('2026-03-15T12:00:00Z');
      expect(result.sourceIds).toEqual([]);
    });

    it('applies safe defaults for missing rich fields', async () => {
      client.get.mockResolvedValue({
        path: '/legacy/page',
        title: 'Legacy',
        summary: 'Old page',
        category: 'misc',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const result = await service.getPage('/legacy/page');

      expect(result.type).toBe('topic');
      expect(result.confidence).toBe('medium');
      expect(result.mounts).toEqual([]);
      expect(result.updatedBy).toBe('unknown');
      expect(result.related).toEqual([]);
      expect(result.size).toBe(0);
      expect(result.zones).toEqual([]);
    });
  });

  // --- search ---
  describe('search', () => {
    it('maps search results with default hybrid mode', async () => {
      client.get.mockResolvedValue([
        {
          path: '/infra/k8s',
          title: 'Kubernetes',
          summary: 'K8s deployment guide',
          category: 'infra',
          updated_at: '2026-02-01T00:00:00Z',
        },
      ]);

      const result = await service.search('kubernetes');

      expect(client.get).toHaveBeenCalledWith('/search?q=kubernetes&mode=hybrid');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: '/infra/k8s',
        title: 'Kubernetes',
        summary: 'K8s deployment guide',
        category: 'infra',
      });
    });

    it('passes the requested search mode', async () => {
      client.get.mockResolvedValue([]);

      await service.search('query', { mode: 'semantic' });

      expect(client.get).toHaveBeenCalledWith('/search?q=query&mode=semantic');
    });
  });

  // --- getLog ---
  describe('getLog', () => {
    it('fetches log with default count', async () => {
      client.get.mockResolvedValue({
        raw: 'line1\nline2',
        entries: ['line1', 'line2'],
      });

      const result = await service.getLog();

      expect(client.get).toHaveBeenCalledWith('/log?n=50');
      expect(result).toEqual({ raw: 'line1\nline2', entries: ['line1', 'line2'] });
    });

    it('fetches log with custom count', async () => {
      client.get.mockResolvedValue({ raw: '', entries: [] });

      await service.getLog(100);

      expect(client.get).toHaveBeenCalledWith('/log?n=100');
    });
  });

  // --- getLint ---
  describe('getLint', () => {
    it('maps lint report with extended LintIssue fields', async () => {
      client.get.mockResolvedValue({
        issues: [
          {
            id: 'lint-1',
            rule: 'L05',
            severity: 'warning',
            message: 'Broken wikilink',
            page_path: '/arch/api',
            mount: 'shared',
            auto_fix: false,
          },
        ],
        pages_checked: 10,
        issues_found: true,
        summary: { error: 0, warning: 1, info: 0 },
      });

      const result = await service.getLint();

      expect(client.get).toHaveBeenCalledWith('/lint');
      expect(result.pagesChecked).toBe(10);
      expect(result.issuesFound).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        id: 'lint-1',
        rule: 'L05',
        severity: 'warning',
        message: 'Broken wikilink',
        pagePath: '/arch/api',
        mount: 'shared',
        autoFix: false,
      });
    });

    it('defaults missing rule to L12', async () => {
      client.get.mockResolvedValue({
        issues: [
          {
            id: 'lint-2',
            severity: 'info',
            message: 'Legacy issue without rule',
            page_path: '/old/page',
            auto_fix: false,
          },
        ],
        pages_checked: 5,
        issues_found: true,
        summary: { error: 0, warning: 0, info: 1 },
      });

      const result = await service.getLint();
      expect(result.issues[0]?.rule).toBe('L12');
    });
  });

  // --- lintFix ---
  describe('lintFix', () => {
    it('posts lint fix and maps result', async () => {
      client.post.mockResolvedValue({
        issues: [],
        pages_checked: 10,
        issues_found: false,
        summary: { error: 0, warning: 0, info: 0 },
      });

      const result = await service.lintFix();

      expect(client.post).toHaveBeenCalledWith('/lint/fix', {});
      expect(result.issuesFound).toBe(false);
    });
  });

  // --- upsertPage ---
  describe('upsertPage', () => {
    it('puts page content', async () => {
      client.put.mockResolvedValue(undefined);

      await service.upsertPage('/test/page', '# New Content');

      expect(client.put).toHaveBeenCalledWith('/page', {
        path: '/test/page',
        content: '# New Content',
      });
    });
  });

  // --- getGraph ---
  describe('getGraph', () => {
    it('maps graph nodes and edges', async () => {
      client.get.mockResolvedValue({
        nodes: [
          { id: 'n1', title: 'Node 1', category: 'infra' },
          { id: 'n2', title: 'Node 2', category: 'api' },
        ],
        edges: [{ source: 'n1', target: 'n2' }],
      });

      const result = await service.getGraph();

      expect(client.get).toHaveBeenCalledWith('/graph');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toEqual({ id: 'n1', title: 'Node 1', category: 'infra' });
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({ source: 'n1', target: 'n2' });
    });
  });

  // --- ingest ---
  describe('ingest', () => {
    it('posts ingest request and maps response', async () => {
      client.post.mockResolvedValue({
        source_id: 'src-abc',
        pages_updated: ['/arch/new-page'],
      });

      const result = await service.ingest({
        title: 'New doc',
        content: 'Some content',
        sourceType: 'document',
        originUrl: 'https://example.com/doc',
      });

      expect(client.post).toHaveBeenCalledWith('/ingest', {
        title: 'New doc',
        content: 'Some content',
        source_type: 'document',
        origin_url: 'https://example.com/doc',
      });
      expect(result).toEqual({
        sourceId: 'src-abc',
        pagesUpdated: ['/arch/new-page'],
      });
    });
  });

  // --- listMounts ---
  describe('listMounts', () => {
    it('delegates to GET /mounts', async () => {
      client.get.mockResolvedValue([]);

      const result = await service.listMounts();

      expect(client.get).toHaveBeenCalledWith('/mounts');
      expect(result).toEqual([]);
    });
  });

  // --- listDreamCycles ---
  describe('listDreamCycles', () => {
    it('delegates to GET /dream-cycles', async () => {
      client.get.mockResolvedValue([]);

      const result = await service.listDreamCycles();

      expect(client.get).toHaveBeenCalledWith('/dream-cycles');
      expect(result).toEqual([]);
    });
  });

  // --- listSources ---
  describe('listSources', () => {
    it('delegates to GET /sources', async () => {
      client.get.mockResolvedValue([]);

      const result = await service.listSources();

      expect(client.get).toHaveBeenCalledWith('/sources');
      expect(result).toEqual([]);
    });
  });
});
