import type { MimirApiPort } from '@/ports';
import type {
  MimirStats,
  MimirPageMeta,
  MimirPage,
  MimirSearchResult,
  MimirLintReport,
  MimirLogEntry,
} from '@/domain';

const NOW = '2026-04-08T12:00:00Z';

const MOCK_PAGES: MimirPage[] = [
  {
    path: 'technical/ravn/architecture.md',
    title: 'Ravn Architecture',
    summary: 'Overview of the Ravn agent architecture',
    category: 'technical',
    updatedAt: NOW,
    sourceIds: ['src_abc123'],
    content: '# Ravn Architecture\n\nRavn is the autonomous agent...\n\n[[technical/ravn/cascade]]',
  },
  {
    path: 'technical/ravn/cascade.md',
    title: 'Cascade Protocol',
    summary: 'How Ravn handles cascading failures',
    category: 'technical',
    updatedAt: NOW,
    sourceIds: ['src_abc123', 'src_def456'],
    content: '# Cascade Protocol\n\nWhen a failure occurs...',
  },
  {
    path: 'projects/niuu/roadmap.md',
    title: 'Niuu Roadmap',
    summary: 'Current roadmap for the Niuu platform',
    category: 'projects',
    updatedAt: NOW,
    sourceIds: ['src_def456'],
    content: '# Niuu Roadmap\n\nQ2 2026 goals...',
  },
  {
    path: 'technical/mimir/ingestion.md',
    title: 'Mímir Ingestion Pipeline',
    summary: 'How sources are ingested into Mímir',
    category: 'technical',
    updatedAt: NOW,
    sourceIds: ['src_ghi789'],
    content: '# Mímir Ingestion Pipeline\n\nThe ingestion pipeline processes...',
  },
];

/**
 * MockMimirAdapter — deterministic test double for MimirApiPort.
 * Full interface compliance with no network calls.
 */
export class MockMimirAdapter implements MimirApiPort {
  private pages: MimirPage[] = MOCK_PAGES.map((p) => ({ ...p }));

  async getStats(): Promise<MimirStats> {
    const categories = [...new Set(this.pages.map((p) => p.category))].sort();
    return {
      pageCount: this.pages.length,
      categories,
      healthy: true,
    };
  }

  async listPages(category?: string): Promise<MimirPageMeta[]> {
    const filtered = category ? this.pages.filter((p) => p.category === category) : this.pages;
    return filtered.map(({ content: _c, ...meta }) => meta);
  }

  async getPage(path: string): Promise<MimirPage> {
    const page = this.pages.find((p) => p.path === path);
    if (!page) {
      throw new Error(`Page not found: ${path}`);
    }
    return { ...page };
  }

  async search(query: string): Promise<MimirSearchResult[]> {
    const q = query.toLowerCase();
    return this.pages
      .filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
      .map((p) => ({
        path: p.path,
        title: p.title,
        summary: p.summary,
        category: p.category,
      }));
  }

  async getLog(_n = 50): Promise<MimirLogEntry> {
    return {
      raw: '## 2026-04-08 Ingestion complete\n## 2026-04-07 Lint run\n',
      entries: ['## 2026-04-08 Ingestion complete', '## 2026-04-07 Lint run'],
    };
  }

  async getLint(): Promise<MimirLintReport> {
    return {
      orphans: [],
      contradictions: [],
      stale: [],
      gaps: ['observability'],
      pagesChecked: this.pages.length,
      issuesFound: true,
    };
  }

  async upsertPage(path: string, content: string): Promise<void> {
    const idx = this.pages.findIndex((p) => p.path === path);
    const now = new Date().toISOString();
    if (idx >= 0) {
      this.pages[idx] = { ...this.pages[idx], content, updatedAt: now };
      return;
    }
    const parts = path.split('/');
    this.pages.push({
      path,
      title: parts[parts.length - 1].replace('.md', ''),
      summary: '',
      category: parts[0],
      updatedAt: now,
      sourceIds: [],
      content,
    });
  }
}
