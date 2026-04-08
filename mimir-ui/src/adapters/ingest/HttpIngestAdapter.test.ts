import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpIngestAdapter } from '@/adapters/ingest/HttpIngestAdapter';
import type { IngestRequest } from '@/domain';

const BASE_URL = 'http://localhost:7477/mimir';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('HttpIngestAdapter', () => {
  let adapter: HttpIngestAdapter;

  beforeEach(() => {
    adapter = new HttpIngestAdapter(BASE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ingest()', () => {
    const request: IngestRequest = {
      title: 'Test Document',
      content: '# Test\n\nContent here.',
      sourceType: 'document',
      originUrl: 'https://example.com/doc',
    };

    it('sends POST /ingest with correct snake_case body', async () => {
      const fetchMock = mockFetch({ source_id: 'src_001', pages_updated: [] });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.ingest(request);

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Document',
          content: '# Test\n\nContent here.',
          source_type: 'document',
          origin_url: 'https://example.com/doc',
        }),
      });
    });

    it('returns sourceId mapped from snake_case', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({ source_id: 'src_abc123', pages_updated: ['technical/doc/page.md'] }),
      );

      const result = await adapter.ingest(request);

      expect(result.sourceId).toBe('src_abc123');
    });

    it('returns pagesUpdated mapped from snake_case', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          source_id: 'src_abc123',
          pages_updated: ['technical/doc/page.md', 'technical/doc/intro.md'],
        }),
      );

      const result = await adapter.ingest(request);

      expect(result.pagesUpdated).toEqual([
        'technical/doc/page.md',
        'technical/doc/intro.md',
      ]);
    });

    it('sends undefined origin_url when not provided', async () => {
      const fetchMock = mockFetch({ source_id: 'src_001', pages_updated: [] });
      vi.stubGlobal('fetch', fetchMock);

      const requestWithoutUrl: IngestRequest = {
        title: 'No URL',
        content: '# Content',
        sourceType: 'text',
      };

      await adapter.ingest(requestWithoutUrl);

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call[1].body as string);
      expect(body.source_type).toBe('text');
    });

    it('throws on non-ok HTTP status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 500));

      await expect(adapter.ingest(request)).rejects.toThrow('Ingest HTTP 500');
    });

    it('throws on 400 status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 400));

      await expect(adapter.ingest(request)).rejects.toThrow('Ingest HTTP 400');
    });

    it('throws on 503 status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 503));

      await expect(adapter.ingest(request)).rejects.toThrow('Ingest HTTP 503');
    });
  });
});
