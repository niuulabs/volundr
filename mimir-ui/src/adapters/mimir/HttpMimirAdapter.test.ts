import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpMimirAdapter } from '@/adapters/mimir/HttpMimirAdapter';

const BASE_URL = 'http://localhost:7477/mimir';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('HttpMimirAdapter', () => {
  let adapter: HttpMimirAdapter;

  beforeEach(() => {
    adapter = new HttpMimirAdapter(BASE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStats()', () => {
    it('calls /stats endpoint', async () => {
      const fetchMock = mockFetch({
        page_count: 42,
        categories: ['technical', 'projects'],
        healthy: true,
      });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getStats();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/stats`);
    });

    it('maps snake_case to camelCase', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          page_count: 42,
          categories: ['technical', 'projects'],
          healthy: true,
        }),
      );

      const stats = await adapter.getStats();

      expect(stats.pageCount).toBe(42);
      expect(stats.categories).toEqual(['technical', 'projects']);
      expect(stats.healthy).toBe(true);
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 500));

      await expect(adapter.getStats()).rejects.toThrow('Mímir HTTP 500');
    });
  });

  describe('listPages()', () => {
    const rawPages = [
      {
        path: 'technical/ravn/architecture.md',
        title: 'Ravn Architecture',
        summary: 'Overview',
        category: 'technical',
        updated_at: '2026-04-08T12:00:00Z',
        source_ids: ['src_abc'],
      },
    ];

    it('calls /pages endpoint', async () => {
      const fetchMock = mockFetch(rawPages);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.listPages();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/pages`);
    });

    it('maps snake_case fields to camelCase', async () => {
      vi.stubGlobal('fetch', mockFetch(rawPages));

      const pages = await adapter.listPages();

      expect(pages[0].updatedAt).toBe('2026-04-08T12:00:00Z');
      expect(pages[0].sourceIds).toEqual(['src_abc']);
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch([], 404));

      await expect(adapter.listPages()).rejects.toThrow('Mímir HTTP 404');
    });
  });

  describe("listPages('technical')", () => {
    it('calls /pages?category=technical', async () => {
      const fetchMock = mockFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.listPages('technical');

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/pages?category=technical`);
    });

    it('URL-encodes the category parameter', async () => {
      const fetchMock = mockFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.listPages('my category');

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/pages?category=my%20category`);
    });
  });

  describe('getPage(path)', () => {
    const rawPage = {
      path: 'technical/ravn/architecture.md',
      title: 'Ravn Architecture',
      summary: 'Overview',
      category: 'technical',
      updated_at: '2026-04-08T12:00:00Z',
      source_ids: ['src_abc'],
      content: '# Ravn Architecture\n\nBody.',
    };

    it('calls /page?path=... endpoint', async () => {
      const fetchMock = mockFetch(rawPage);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getPage('technical/ravn/architecture.md');

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/page?path=technical%2Fravn%2Farchitecture.md`,
      );
    });

    it('includes content in the returned page', async () => {
      vi.stubGlobal('fetch', mockFetch(rawPage));

      const page = await adapter.getPage('technical/ravn/architecture.md');

      expect(page.content).toBe('# Ravn Architecture\n\nBody.');
    });

    it('maps all snake_case fields', async () => {
      vi.stubGlobal('fetch', mockFetch(rawPage));

      const page = await adapter.getPage('technical/ravn/architecture.md');

      expect(page.updatedAt).toBe('2026-04-08T12:00:00Z');
      expect(page.sourceIds).toEqual(['src_abc']);
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 404));

      await expect(adapter.getPage('missing.md')).rejects.toThrow('Mímir HTTP 404');
    });
  });

  describe('search(q)', () => {
    const rawResults = [
      {
        path: 'technical/ravn/architecture.md',
        title: 'Ravn Architecture',
        summary: 'Overview',
        category: 'technical',
      },
    ];

    it('calls /search?q=... endpoint', async () => {
      const fetchMock = mockFetch(rawResults);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.search('ravn');

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/search?q=ravn`);
    });

    it('URL-encodes the query parameter', async () => {
      const fetchMock = mockFetch([]);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.search('hello world');

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/search?q=hello%20world`);
    });

    it('returns mapped results', async () => {
      vi.stubGlobal('fetch', mockFetch(rawResults));

      const results = await adapter.search('ravn');

      expect(results[0].path).toBe('technical/ravn/architecture.md');
      expect(results[0].title).toBe('Ravn Architecture');
      expect(results[0].category).toBe('technical');
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch([], 500));

      await expect(adapter.search('ravn')).rejects.toThrow('Mímir HTTP 500');
    });
  });

  describe('getLog(n)', () => {
    const rawLog = {
      raw: '## 2026-04-08 ingestion complete\n',
      entries: ['## 2026-04-08 ingestion complete'],
    };

    it('calls /log?n=50 by default', async () => {
      const fetchMock = mockFetch(rawLog);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getLog();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/log?n=50`);
    });

    it('calls /log?n=... with provided n', async () => {
      const fetchMock = mockFetch(rawLog);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getLog(10);

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/log?n=10`);
    });

    it('returns raw and entries', async () => {
      vi.stubGlobal('fetch', mockFetch(rawLog));

      const log = await adapter.getLog();

      expect(log.raw).toBe('## 2026-04-08 ingestion complete\n');
      expect(log.entries).toEqual(['## 2026-04-08 ingestion complete']);
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 500));

      await expect(adapter.getLog()).rejects.toThrow('Mímir HTTP 500');
    });
  });

  describe('getLint()', () => {
    const rawReport = {
      orphans: ['orphan.md'],
      contradictions: [],
      stale: ['old.md'],
      gaps: ['observability'],
      pages_checked: 10,
      issues_found: true,
    };

    it('calls /lint endpoint', async () => {
      const fetchMock = mockFetch(rawReport);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getLint();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/lint`);
    });

    it('maps snake_case to camelCase', async () => {
      vi.stubGlobal('fetch', mockFetch(rawReport));

      const report = await adapter.getLint();

      expect(report.pagesChecked).toBe(10);
      expect(report.issuesFound).toBe(true);
    });

    it('returns all array fields', async () => {
      vi.stubGlobal('fetch', mockFetch(rawReport));

      const report = await adapter.getLint();

      expect(report.orphans).toEqual(['orphan.md']);
      expect(report.contradictions).toEqual([]);
      expect(report.stale).toEqual(['old.md']);
      expect(report.gaps).toEqual(['observability']);
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 503));

      await expect(adapter.getLint()).rejects.toThrow('Mímir HTTP 503');
    });
  });

  describe('upsertPage(path, content)', () => {
    it('sends PUT /page with correct body', async () => {
      const fetchMock = mockFetch(null, 200);
      vi.stubGlobal('fetch', fetchMock);

      await adapter.upsertPage('technical/ravn/architecture.md', '# Updated');

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/page`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'technical/ravn/architecture.md',
          content: '# Updated',
        }),
      });
    });

    it('does not throw on successful PUT', async () => {
      vi.stubGlobal('fetch', mockFetch(null, 200));

      await expect(
        adapter.upsertPage('technical/ravn/architecture.md', '# Updated'),
      ).resolves.toBeUndefined();
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 403));

      await expect(
        adapter.upsertPage('technical/ravn/architecture.md', '# Updated'),
      ).rejects.toThrow('Mímir HTTP 403');
    });

    it('throws error containing PUT in message', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 422));

      await expect(adapter.upsertPage('some/path.md', 'content')).rejects.toThrow('PUT');
    });
  });
});
