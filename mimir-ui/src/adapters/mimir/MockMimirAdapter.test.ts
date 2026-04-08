import { describe, it, expect, beforeEach } from 'vitest';
import { MockMimirAdapter } from '@/adapters/mimir/MockMimirAdapter';

describe('MockMimirAdapter', () => {
  let adapter: MockMimirAdapter;

  beforeEach(() => {
    adapter = new MockMimirAdapter();
  });

  describe('getStats()', () => {
    it('returns a pageCount', async () => {
      const stats = await adapter.getStats();
      expect(typeof stats.pageCount).toBe('number');
      expect(stats.pageCount).toBeGreaterThan(0);
    });

    it('returns a categories array', async () => {
      const stats = await adapter.getStats();
      expect(Array.isArray(stats.categories)).toBe(true);
      expect(stats.categories.length).toBeGreaterThan(0);
    });

    it('returns healthy=true', async () => {
      const stats = await adapter.getStats();
      expect(stats.healthy).toBe(true);
    });

    it('pageCount matches number of pages', async () => {
      const stats = await adapter.getStats();
      const pages = await adapter.listPages();
      expect(stats.pageCount).toBe(pages.length);
    });
  });

  describe('listPages()', () => {
    it('returns all pages when no category filter', async () => {
      const pages = await adapter.listPages();
      expect(pages.length).toBeGreaterThan(0);
    });

    it('returns pages without content field', async () => {
      const pages = await adapter.listPages();
      for (const page of pages) {
        expect('content' in page).toBe(false);
      }
    });

    it('returns pages with required meta fields', async () => {
      const pages = await adapter.listPages();
      for (const page of pages) {
        expect(page.path).toBeDefined();
        expect(page.title).toBeDefined();
        expect(page.category).toBeDefined();
        expect(page.updatedAt).toBeDefined();
      }
    });
  });

  describe('listPages(category)', () => {
    it('filters to only technical category pages', async () => {
      const pages = await adapter.listPages('technical');
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        expect(page.category).toBe('technical');
      }
    });

    it('returns fewer pages than unfiltered when category is specific', async () => {
      const allPages = await adapter.listPages();
      const technicalPages = await adapter.listPages('technical');
      expect(technicalPages.length).toBeLessThan(allPages.length);
    });

    it('returns empty array for unknown category', async () => {
      const pages = await adapter.listPages('nonexistent-category');
      expect(pages).toEqual([]);
    });
  });

  describe('getPage(path)', () => {
    it('returns the page with content', async () => {
      const page = await adapter.getPage('technical/ravn/architecture.md');
      expect(page.path).toBe('technical/ravn/architecture.md');
      expect(page.title).toBe('Ravn Architecture');
      expect(typeof page.content).toBe('string');
      expect(page.content.length).toBeGreaterThan(0);
    });

    it('returns a copy of the page (not reference)', async () => {
      const page1 = await adapter.getPage('technical/ravn/architecture.md');
      const page2 = await adapter.getPage('technical/ravn/architecture.md');
      expect(page1).not.toBe(page2);
    });

    it('includes all required fields', async () => {
      const page = await adapter.getPage('technical/ravn/architecture.md');
      expect(page.path).toBeDefined();
      expect(page.title).toBeDefined();
      expect(page.summary).toBeDefined();
      expect(page.category).toBeDefined();
      expect(page.updatedAt).toBeDefined();
      expect(Array.isArray(page.sourceIds)).toBe(true);
      expect(page.content).toBeDefined();
    });
  });

  describe('getPage(non-existent)', () => {
    it('throws for a path that does not exist', async () => {
      await expect(adapter.getPage('does/not/exist.md')).rejects.toThrow(
        'Page not found: does/not/exist.md',
      );
    });

    it('throws with an informative message', async () => {
      await expect(adapter.getPage('missing/page.md')).rejects.toThrow('Page not found');
    });
  });

  describe('search()', () => {
    it("returns matching pages for 'ravn'", async () => {
      const results = await adapter.search('ravn');
      expect(results.length).toBeGreaterThan(0);
      const paths = results.map((r) => r.path);
      expect(paths.some((p) => p.includes('ravn'))).toBe(true);
    });

    it('search is case-insensitive', async () => {
      const lower = await adapter.search('ravn');
      const upper = await adapter.search('RAVN');
      expect(upper.length).toBe(lower.length);
    });

    it("returns empty array for 'zzz'", async () => {
      const results = await adapter.search('zzz');
      expect(results).toEqual([]);
    });

    it('returns results with required fields', async () => {
      const results = await adapter.search('ravn');
      for (const r of results) {
        expect(r.path).toBeDefined();
        expect(r.title).toBeDefined();
        expect(r.summary).toBeDefined();
        expect(r.category).toBeDefined();
      }
    });
  });

  describe('getLog()', () => {
    it('returns an object with entries array', async () => {
      const log = await adapter.getLog();
      expect(Array.isArray(log.entries)).toBe(true);
    });

    it('returns entries with content', async () => {
      const log = await adapter.getLog();
      expect(log.entries.length).toBeGreaterThan(0);
    });

    it('returns a raw string', async () => {
      const log = await adapter.getLog();
      expect(typeof log.raw).toBe('string');
    });

    it('accepts optional n parameter', async () => {
      const log = await adapter.getLog(10);
      expect(Array.isArray(log.entries)).toBe(true);
    });
  });

  describe('getLint()', () => {
    it('returns a report with pagesChecked > 0', async () => {
      const report = await adapter.getLint();
      expect(report.pagesChecked).toBeGreaterThan(0);
    });

    it('returns arrays for orphans, contradictions, stale, gaps', async () => {
      const report = await adapter.getLint();
      expect(Array.isArray(report.orphans)).toBe(true);
      expect(Array.isArray(report.contradictions)).toBe(true);
      expect(Array.isArray(report.stale)).toBe(true);
      expect(Array.isArray(report.gaps)).toBe(true);
    });

    it('returns issuesFound boolean', async () => {
      const report = await adapter.getLint();
      expect(typeof report.issuesFound).toBe('boolean');
    });

    it('pagesChecked matches current page count', async () => {
      const stats = await adapter.getStats();
      const report = await adapter.getLint();
      expect(report.pagesChecked).toBe(stats.pageCount);
    });
  });

  describe('upsertPage(existing path, new content)', () => {
    it('updates content of existing page', async () => {
      const newContent = '# Updated Content\n\nNew body text.';
      await adapter.upsertPage('technical/ravn/architecture.md', newContent);
      const page = await adapter.getPage('technical/ravn/architecture.md');
      expect(page.content).toBe(newContent);
    });

    it('does not increase page count when updating existing', async () => {
      const before = await adapter.getStats();
      await adapter.upsertPage(
        'technical/ravn/architecture.md',
        '# New Content',
      );
      const after = await adapter.getStats();
      expect(after.pageCount).toBe(before.pageCount);
    });

    it('updates pagesChecked in getLint after upsert', async () => {
      const before = await adapter.getLint();
      await adapter.upsertPage(
        'technical/ravn/architecture.md',
        '# Updated',
      );
      const after = await adapter.getLint();
      expect(after.pagesChecked).toBe(before.pagesChecked);
    });
  });

  describe('upsertPage(new path, content)', () => {
    it('adds a new page', async () => {
      await adapter.upsertPage('technical/newdoc/guide.md', '# New Guide');
      const page = await adapter.getPage('technical/newdoc/guide.md');
      expect(page.path).toBe('technical/newdoc/guide.md');
      expect(page.content).toBe('# New Guide');
    });

    it('increases page count when adding a new page', async () => {
      const before = await adapter.getStats();
      await adapter.upsertPage('brand/new/page.md', '# Brand New');
      const after = await adapter.getStats();
      expect(after.pageCount).toBe(before.pageCount + 1);
    });

    it('derives category from path prefix', async () => {
      await adapter.upsertPage('projects/demo/overview.md', '# Demo');
      const page = await adapter.getPage('projects/demo/overview.md');
      expect(page.category).toBe('projects');
    });

    it('derives title from filename', async () => {
      await adapter.upsertPage('technical/ops/deploy.md', '# Deploy');
      const page = await adapter.getPage('technical/ops/deploy.md');
      expect(page.title).toBe('deploy');
    });

    it('new page appears in listPages()', async () => {
      await adapter.upsertPage('technical/newdoc/added.md', '# Added');
      const pages = await adapter.listPages();
      expect(pages.some((p) => p.path === 'technical/newdoc/added.md')).toBe(true);
    });
  });
});
