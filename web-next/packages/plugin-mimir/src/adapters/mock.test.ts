import { describe, it, expect } from 'vitest';
import { createMimirMockAdapter } from './mock';

describe('createMimirMockAdapter', () => {
  describe('mounts.listMounts', () => {
    it('returns a non-empty list of mounts', async () => {
      const svc = createMimirMockAdapter();
      const mounts = await svc.mounts.listMounts();
      expect(mounts.length).toBeGreaterThan(0);
    });

    it('each mount has required fields', async () => {
      const svc = createMimirMockAdapter();
      const mounts = await svc.mounts.listMounts();
      for (const mount of mounts) {
        expect(mount).toHaveProperty('name');
        expect(mount).toHaveProperty('role');
        expect(mount).toHaveProperty('status');
        expect(mount).toHaveProperty('pages');
        expect(mount).toHaveProperty('url');
      }
    });

    it('includes mounts with local, shared and domain roles', async () => {
      const svc = createMimirMockAdapter();
      const mounts = await svc.mounts.listMounts();
      const roles = mounts.map((m) => m.role);
      expect(roles).toContain('local');
      expect(roles).toContain('shared');
      expect(roles).toContain('domain');
    });
  });

  describe('pages.getStats', () => {
    it('returns healthy flag and non-zero pageCount', async () => {
      const svc = createMimirMockAdapter();
      const stats = await svc.pages.getStats();
      expect(stats.pageCount).toBeGreaterThan(0);
      expect(typeof stats.healthy).toBe('boolean');
      expect(Array.isArray(stats.categories)).toBe(true);
    });
  });

  describe('pages.listPages', () => {
    it('returns all pages when no filter is given', async () => {
      const svc = createMimirMockAdapter();
      const pages = await svc.pages.listPages();
      expect(pages.length).toBeGreaterThan(0);
    });

    it('filters by category', async () => {
      const svc = createMimirMockAdapter();
      const pages = await svc.pages.listPages({ category: 'arch' });
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.every((p) => p.category === 'arch')).toBe(true);
    });

    it('filters by mountName', async () => {
      const svc = createMimirMockAdapter();
      const pages = await svc.pages.listPages({ mountName: 'local' });
      expect(pages.every((p) => p.mounts.includes('local'))).toBe(true);
    });

    it('each result has PageMeta fields', async () => {
      const svc = createMimirMockAdapter();
      const pages = await svc.pages.listPages();
      for (const p of pages) {
        expect(p).toHaveProperty('path');
        expect(p).toHaveProperty('title');
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('confidence');
        expect(p).toHaveProperty('mounts');
      }
    });
  });

  describe('pages.getPage', () => {
    it('returns a page for a known path', async () => {
      const svc = createMimirMockAdapter();
      const page = await svc.pages.getPage('/arch/overview');
      expect(page).not.toBeNull();
      expect(page!.path).toBe('/arch/overview');
    });

    it('returns null for an unknown path', async () => {
      const svc = createMimirMockAdapter();
      const page = await svc.pages.getPage('/does-not-exist');
      expect(page).toBeNull();
    });

    it('returned page may have zones', async () => {
      const svc = createMimirMockAdapter();
      const page = await svc.pages.getPage('/arch/overview');
      expect(page).not.toBeNull();
      expect(page!.zones).toBeDefined();
      expect(page!.zones!.length).toBeGreaterThan(0);
    });
  });

  describe('pages.upsertPage', () => {
    it('resolves without error', async () => {
      const svc = createMimirMockAdapter();
      await expect(svc.pages.upsertPage('/test/new', '# New')).resolves.toBeUndefined();
    });
  });

  describe('pages.search', () => {
    it('returns results matching the query', async () => {
      const svc = createMimirMockAdapter();
      const results = await svc.pages.search('architecture');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('path');
      expect(results[0]).toHaveProperty('type');
      expect(results[0]).toHaveProperty('confidence');
    });

    it('returns empty array for unmatched query', async () => {
      const svc = createMimirMockAdapter();
      const results = await svc.pages.search('xyzxyzxyz_no_match');
      expect(results).toHaveLength(0);
    });
  });

  describe('embeddings.semanticSearch', () => {
    it('returns results with score and mountName', async () => {
      const svc = createMimirMockAdapter();
      const results = await svc.embeddings.semanticSearch('architecture');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('mountName');
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('respects topK limit', async () => {
      const svc = createMimirMockAdapter();
      const results = await svc.embeddings.semanticSearch('anything', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('lint.getLintReport', () => {
    it('returns a report with issues and summary', async () => {
      const svc = createMimirMockAdapter();
      const report = await svc.lint.getLintReport();
      expect(Array.isArray(report.issues)).toBe(true);
      expect(typeof report.pagesChecked).toBe('number');
      expect(report.summary).toHaveProperty('error');
      expect(report.summary).toHaveProperty('warn');
      expect(report.summary).toHaveProperty('info');
    });

    it('summary tallies match issue list', async () => {
      const svc = createMimirMockAdapter();
      const report = await svc.lint.getLintReport();
      const manual = {
        error: report.issues.filter((i) => i.severity === 'error').length,
        warn: report.issues.filter((i) => i.severity === 'warn').length,
        info: report.issues.filter((i) => i.severity === 'info').length,
      };
      expect(report.summary).toEqual(manual);
    });
  });

  describe('lint.runAutoFix', () => {
    it('removes auto-fixable issues', async () => {
      const svc = createMimirMockAdapter();
      const before = await svc.lint.getLintReport();
      const after = await svc.lint.runAutoFix();
      const autoFixableCount = before.issues.filter((i) => i.autoFix).length;
      expect(after.issues.length).toBe(before.issues.length - autoFixableCount);
    });

    it('only fixes specified issue IDs when provided', async () => {
      const svc = createMimirMockAdapter();
      const before = await svc.lint.getLintReport();
      const autoFixable = before.issues.filter((i) => i.autoFix);
      if (autoFixable.length === 0) return;
      const idToFix = autoFixable[0]!.id;
      const after = await svc.lint.runAutoFix([idToFix]);
      expect(after.issues.find((i) => i.id === idToFix)).toBeUndefined();
    });
  });

  describe('lint.getDreamCycles', () => {
    it('returns dream cycle records', async () => {
      const svc = createMimirMockAdapter();
      const cycles = await svc.lint.getDreamCycles();
      expect(cycles.length).toBeGreaterThan(0);
      for (const c of cycles) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('ravn');
        expect(c).toHaveProperty('timestamp');
        expect(c).toHaveProperty('pagesUpdated');
        expect(c).toHaveProperty('durationMs');
      }
    });

    it('respects limit parameter', async () => {
      const svc = createMimirMockAdapter();
      const cycles = await svc.lint.getDreamCycles(1);
      expect(cycles.length).toBeLessThanOrEqual(1);
    });
  });
});
