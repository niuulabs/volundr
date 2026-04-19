import { describe, it, expect } from 'vitest';
import { createMockMimirService } from './mock';

describe('mock Mimir service', () => {
  const service = createMockMimirService();

  describe('listMounts', () => {
    it('returns seeded mounts', async () => {
      const mounts = await service.listMounts();
      expect(mounts.length).toBeGreaterThanOrEqual(3);
      const roles = mounts.map((m) => m.role);
      expect(roles).toContain('local');
      expect(roles).toContain('shared');
      expect(roles).toContain('domain');
    });

    it('each mount has required fields', async () => {
      const mounts = await service.listMounts();
      for (const mount of mounts) {
        expect(mount.name).toBeTruthy();
        expect(mount.host).toBeTruthy();
        expect(mount.url).toBeTruthy();
        expect(typeof mount.pages).toBe('number');
        expect(typeof mount.sources).toBe('number');
      }
    });
  });

  describe('getStats', () => {
    it('returns stats with page count and categories', async () => {
      const stats = await service.getStats();
      expect(stats.pageCount).toBeGreaterThan(0);
      expect(stats.categories.length).toBeGreaterThan(0);
      expect(typeof stats.healthy).toBe('boolean');
    });
  });

  describe('listPages', () => {
    it('returns all pages without filter', async () => {
      const pages = await service.listPages();
      expect(pages.length).toBeGreaterThan(0);
    });

    it('filters pages by category', async () => {
      const all = await service.listPages();
      const category = all[0]?.category;
      if (!category) return;

      const filtered = await service.listPages({ category });
      expect(filtered.every((p) => p.category === category)).toBe(true);
    });

    it('returns empty array for unknown category', async () => {
      const result = await service.listPages({ category: '__nonexistent__' });
      expect(result).toEqual([]);
    });
  });

  describe('getPage', () => {
    it('returns a rich page with zones for known paths', async () => {
      const page = await service.getPage('/arch/overview');
      expect(page.type).toBeTruthy();
      expect(page.confidence).toBeTruthy();
      expect(page.mounts.length).toBeGreaterThan(0);
      expect(page.zones).toBeDefined();
      expect((page.zones ?? []).length).toBeGreaterThan(0);
    });

    it('returns a minimal page for unknown paths', async () => {
      const page = await service.getPage('/unknown/path');
      expect(page.path).toBe('/unknown/path');
      expect(page.type).toBe('topic');
      expect(page.confidence).toBe('medium');
    });
  });

  describe('search', () => {
    it('returns results matching the query in title or summary', async () => {
      const results = await service.search('architecture');
      expect(results.length).toBeGreaterThan(0);
      const hasMatch = results.some(
        (r) =>
          r.title.toLowerCase().includes('architecture') ||
          r.summary.toLowerCase().includes('architecture'),
      );
      expect(hasMatch).toBe(true);
    });

    it('returns empty array for unmatched query', async () => {
      const results = await service.search('zzz_no_match_xyz');
      expect(results).toEqual([]);
    });
  });

  describe('getGraph', () => {
    it('returns a graph with nodes and edges', async () => {
      const graph = await service.getGraph();
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it('nodes have required fields', async () => {
      const graph = await service.getGraph();
      for (const node of graph.nodes) {
        expect(node.id).toBeTruthy();
        expect(node.title).toBeTruthy();
        expect(node.category).toBeTruthy();
      }
    });
  });

  describe('getLint', () => {
    it('returns a lint report with issues', async () => {
      const report = await service.getLint();
      expect(report.issues.length).toBeGreaterThan(0);
      expect(typeof report.pagesChecked).toBe('number');
      expect(report.issuesFound).toBe(true);
    });

    it('issues have LintRule codes', async () => {
      const report = await service.getLint();
      for (const issue of report.issues) {
        expect(issue.rule).toMatch(/^L\d{2}$/);
        expect(['error', 'warning', 'info']).toContain(issue.severity);
      }
    });
  });

  describe('lintFix', () => {
    it('returns report with only non-auto-fixable issues', async () => {
      const report = await service.lintFix();
      for (const issue of report.issues) {
        expect(issue.autoFix).toBe(false);
      }
    });
  });

  describe('getLog', () => {
    it('returns a log entry with raw and entries', async () => {
      const log = await service.getLog();
      expect(typeof log.raw).toBe('string');
      expect(Array.isArray(log.entries)).toBe(true);
    });
  });

  describe('ingest', () => {
    it('returns a source id and pages updated', async () => {
      const result = await service.ingest({
        title: 'Test Document',
        content: 'Content here',
        sourceType: 'document',
      });
      expect(result.sourceId).toBeTruthy();
      expect(result.pagesUpdated.length).toBeGreaterThan(0);
    });
  });

  describe('listDreamCycles', () => {
    it('returns seeded dream cycles', async () => {
      const cycles = await service.listDreamCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('each cycle has required fields', async () => {
      const cycles = await service.listDreamCycles();
      for (const cycle of cycles) {
        expect(cycle.id).toBeTruthy();
        expect(cycle.ravnId).toBeTruthy();
        expect(cycle.mounts.length).toBeGreaterThan(0);
        expect(typeof cycle.durationMs).toBe('number');
        expect(cycle.summary).toBeDefined();
      }
    });
  });

  describe('listSources', () => {
    it('returns seeded source records', async () => {
      const sources = await service.listSources();
      expect(sources.length).toBeGreaterThan(0);
    });

    it('each source has id, origin, and ingestAgent', async () => {
      const sources = await service.listSources();
      for (const source of sources) {
        expect(source.id).toBeTruthy();
        expect(source.origin).toBeTruthy();
        expect(source.ingestAgent).toBeTruthy();
      }
    });
  });

  describe('upsertPage', () => {
    it('resolves without error', async () => {
      await expect(service.upsertPage('/test/page', '# content')).resolves.toBeUndefined();
    });
  });
});
