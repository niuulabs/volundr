import { describe, it, expect, beforeEach } from 'vitest';
import { MockMimirAdapter } from '@/adapters/mimir/MockMimirAdapter';
import { MockIngestAdapter } from '@/adapters/ingest/MockIngestAdapter';
import { MockGraphAdapter } from '@/adapters/graph/MockGraphAdapter';
import type { IngestRequest } from '@/domain';

describe('Full ingest flow', () => {
  let mimirAdapter: MockMimirAdapter;
  let ingestAdapter: MockIngestAdapter;
  let graphAdapter: MockGraphAdapter;

  beforeEach(() => {
    mimirAdapter = new MockMimirAdapter();
    ingestAdapter = new MockIngestAdapter();
    graphAdapter = new MockGraphAdapter();
  });

  it('ingest() records submission in MockIngestAdapter', async () => {
    const request: IngestRequest = {
      title: 'Ravn Integration Guide',
      content: '# Ravn Integration\n\nHow to integrate with Ravn.',
      sourceType: 'document',
      originUrl: 'https://docs.example.com/ravn',
    };

    await ingestAdapter.ingest(request);

    expect(ingestAdapter.submissions).toHaveLength(1);
    expect(ingestAdapter.submissions[0].title).toBe('Ravn Integration Guide');
    expect(ingestAdapter.submissions[0].content).toContain('Ravn Integration');
    expect(ingestAdapter.submissions[0].originUrl).toBe('https://docs.example.com/ravn');
  });

  it('ingest() returns a sourceId and pagesUpdated', async () => {
    const request: IngestRequest = {
      title: 'New Document',
      content: '# New Document\n\nContent.',
      sourceType: 'text',
    };

    const result = await ingestAdapter.ingest(request);

    expect(typeof result.sourceId).toBe('string');
    expect(result.sourceId.startsWith('src_mock_')).toBe(true);
    expect(Array.isArray(result.pagesUpdated)).toBe(true);
    expect(result.pagesUpdated.length).toBeGreaterThan(0);
  });

  it('upsertPage() makes new page appear in listPages()', async () => {
    const newPath = 'technical/ravn/integration.md';
    const newContent = '# Ravn Integration\n\nDetails here.';

    await mimirAdapter.upsertPage(newPath, newContent);

    const pages = await mimirAdapter.listPages();
    const found = pages.find((p) => p.path === newPath);
    expect(found).toBeDefined();
    expect(found?.title).toBeDefined();
  });

  it('getPage() returns the newly upserted page', async () => {
    const newPath = 'technical/ravn/integration.md';
    const newContent = '# Ravn Integration\n\nDetails here.';

    await mimirAdapter.upsertPage(newPath, newContent);

    const page = await mimirAdapter.getPage(newPath);
    expect(page.path).toBe(newPath);
    expect(page.content).toBe(newContent);
  });

  it('full flow: ingest, simulate write, verify page exists', async () => {
    // Step 1: Submit ingest request
    const request: IngestRequest = {
      title: 'Ravn Deployment Runbook',
      content: '# Deployment Runbook\n\nSteps to deploy Ravn.',
      sourceType: 'document',
    };
    const ingestResult = await ingestAdapter.ingest(request);

    expect(ingestAdapter.submissions).toHaveLength(1);
    expect(ingestResult.sourceId).toMatch(/^src_mock_/);

    // Step 2: Simulate Ravn writing the ingested content as a page
    const targetPath = 'technical/ravn/deployment-runbook.md';
    await mimirAdapter.upsertPage(targetPath, request.content);

    // Step 3: Verify the page is in listPages()
    const allPages = await mimirAdapter.listPages();
    const newPage = allPages.find((p) => p.path === targetPath);
    expect(newPage).toBeDefined();
    expect(newPage?.category).toBe('technical');

    // Step 4: Verify getPage() returns the page with content
    const page = await mimirAdapter.getPage(targetPath);
    expect(page.content).toBe(request.content);
    expect(page.title).toBe('deployment-runbook');
  });

  it('stats update after upsert', async () => {
    const beforeStats = await mimirAdapter.getStats();

    await mimirAdapter.upsertPage('technical/new/page.md', '# New Page');

    const afterStats = await mimirAdapter.getStats();
    expect(afterStats.pageCount).toBe(beforeStats.pageCount + 1);
  });

  it('graph data includes pre-existing pages', async () => {
    const graph = await graphAdapter.getGraph();

    expect(graph.nodes.length).toBeGreaterThan(0);
    const ravnNode = graph.nodes.find((n) => n.id.includes('ravn'));
    expect(ravnNode).toBeDefined();
  });

  it('graph edges represent links between pages', async () => {
    const graph = await graphAdapter.getGraph();

    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(typeof edge.source).toBe('string');
      expect(typeof edge.target).toBe('string');
    }
  });

  it('multiple ingests produce unique sourceIds', async () => {
    const request1: IngestRequest = {
      title: 'Doc 1',
      content: '# Doc 1',
      sourceType: 'document',
    };
    const request2: IngestRequest = {
      title: 'Doc 2',
      content: '# Doc 2',
      sourceType: 'text',
    };

    const result1 = await ingestAdapter.ingest(request1);
    const result2 = await ingestAdapter.ingest(request2);

    expect(result1.sourceId).not.toBe(result2.sourceId);
    expect(ingestAdapter.submissions).toHaveLength(2);
  });

  it('search finds newly upserted page', async () => {
    await mimirAdapter.upsertPage(
      'technical/ravn/circuit-breaker.md',
      '# Circuit Breaker Pattern\n\nUsed in Ravn for resilience.',
    );

    const results = await mimirAdapter.search('circuit breaker');
    expect(results.some((r) => r.path === 'technical/ravn/circuit-breaker.md')).toBe(true);
  });

  it('upsertPage updates content of existing page without duplicating', async () => {
    const path = 'technical/ravn/architecture.md';
    const beforePages = await mimirAdapter.listPages();
    const beforeCount = beforePages.length;

    await mimirAdapter.upsertPage(path, '# Updated Architecture\n\nNew content.');

    const afterPages = await mimirAdapter.listPages();
    expect(afterPages.length).toBe(beforeCount);

    const page = await mimirAdapter.getPage(path);
    expect(page.content).toBe('# Updated Architecture\n\nNew content.');
  });
});
