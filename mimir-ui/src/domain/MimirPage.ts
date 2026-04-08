export interface MimirPageMeta {
  path: string;
  title: string;
  summary: string;
  category: string;
  updatedAt: string;
  sourceIds: string[];
}

export interface MimirPage extends MimirPageMeta {
  content: string;
}

export interface MimirStats {
  pageCount: number;
  categories: string[];
  healthy: boolean;
}

export interface MimirSearchResult {
  path: string;
  title: string;
  summary: string;
  category: string;
}

export interface MimirLintReport {
  orphans: string[];
  contradictions: string[];
  stale: string[];
  gaps: string[];
  pagesChecked: number;
  issuesFound: boolean;
}

export interface MimirLogEntry {
  raw: string;
  entries: string[];
}
