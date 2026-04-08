import { describe, it, expect, beforeEach } from 'vitest';
import { MockIngestAdapter } from '@/adapters/ingest/MockIngestAdapter';
import type { IngestRequest } from '@/domain';

const baseRequest: IngestRequest = {
  title: 'Test Document',
  content: '# Test\n\nContent.',
  sourceType: 'document',
};

describe('MockIngestAdapter', () => {
  let adapter: MockIngestAdapter;

  beforeEach(() => {
    adapter = new MockIngestAdapter();
  });

  describe('ingest()', () => {
    it('returns a sourceId', async () => {
      const result = await adapter.ingest(baseRequest);
      expect(typeof result.sourceId).toBe('string');
      expect(result.sourceId.length).toBeGreaterThan(0);
    });

    it('returns a pagesUpdated array', async () => {
      const result = await adapter.ingest(baseRequest);
      expect(Array.isArray(result.pagesUpdated)).toBe(true);
      expect(result.pagesUpdated.length).toBeGreaterThan(0);
    });

    it('records the submission in submissions', async () => {
      await adapter.ingest(baseRequest);
      expect(adapter.submissions).toHaveLength(1);
      expect(adapter.submissions[0]).toEqual(baseRequest);
    });

    it('records multiple submissions', async () => {
      const request2: IngestRequest = {
        title: 'Second Doc',
        content: '# Second',
        sourceType: 'text',
      };
      await adapter.ingest(baseRequest);
      await adapter.ingest(request2);
      expect(adapter.submissions).toHaveLength(2);
      expect(adapter.submissions[1].title).toBe('Second Doc');
    });

    it('starts with empty submissions', () => {
      expect(adapter.submissions).toHaveLength(0);
    });
  });

  describe('multiple calls return unique sourceIds', () => {
    it('two calls produce different sourceIds', async () => {
      const result1 = await adapter.ingest(baseRequest);
      const result2 = await adapter.ingest(baseRequest);
      expect(result1.sourceId).not.toBe(result2.sourceId);
    });

    it('sourceId format is consistently prefixed', async () => {
      const result = await adapter.ingest(baseRequest);
      expect(result.sourceId).toMatch(/^src_mock_/);
    });

    it('three calls produce three unique sourceIds', async () => {
      const results = await Promise.all([
        adapter.ingest(baseRequest),
        adapter.ingest(baseRequest),
        adapter.ingest(baseRequest),
      ]);
      const ids = results.map((r) => r.sourceId);
      const unique = new Set(ids);
      expect(unique.size).toBe(3);
    });
  });
});
