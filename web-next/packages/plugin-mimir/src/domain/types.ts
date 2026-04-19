/**
 * Mimir domain types.
 *
 * Combines HTTP-level types (copied from the legacy Mimir client in web/) with
 * the richer domain types introduced in the plugin rewrite.
 *
 * The Mount type comes from @niuulabs/domain (canonical cross-plugin type).
 */

export type { Mount, MountRole, MountStatus } from '@niuulabs/domain';

// ---------------------------------------------------------------------------
// Legacy types — HTTP-level (copied from web/src/modules/mimir/api/types.ts)
// ---------------------------------------------------------------------------

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

/** Severity level for a lint issue. */
export type LintSeverity = 'error' | 'warning' | 'info';

export interface MimirLogEntry {
  raw: string;
  entries: string[];
}

export interface GraphNode {
  id: string;
  title: string;
  category: string;
  /** Number of inbound edges — set during graph processing. */
  inboundCount?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface MimirGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type IngestStatus = 'queued' | 'running' | 'complete' | 'failed';

export type IngestSourceType = 'document' | 'web' | 'conversation' | 'text';

export interface IngestJob {
  id: string;
  title: string;
  sourceType: IngestSourceType;
  status: IngestStatus;
  instanceName: string;
  /** Pages written during run. */
  pagesUpdated: string[];
  /** Current activity message when running. */
  currentActivity?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface IngestRequest {
  title: string;
  content: string;
  sourceType: IngestSourceType;
  originUrl?: string;
}

export interface IngestResponse {
  sourceId: string;
  pagesUpdated: string[];
}

/** Transition a job to the next state (immutable). */
export function transitionJob(job: IngestJob, update: Partial<IngestJob>): IngestJob {
  return { ...job, ...update };
}

/** Returns true if the job is in a terminal state. */
export function isTerminal(status: IngestStatus): boolean {
  return status === 'complete' || status === 'failed';
}

// ---------------------------------------------------------------------------
// Rich domain types — introduced in plugin rewrite
// ---------------------------------------------------------------------------

/** Structured kind of a Mimir page. */
export type PageType = 'entity' | 'topic' | 'directive' | 'preference' | 'decision';

/** Confidence level as assessed by the last synthesis ravn. */
export type PageConfidence = 'high' | 'medium' | 'low';

/** Zone: key facts — a bulleted list of distilled facts. */
export interface ZoneKeyFacts {
  kind: 'key-facts';
  items: string[];
}

/** Zone: relationships to other pages. */
export interface ZoneRelationships {
  kind: 'relationships';
  items: { slug: string; note: string }[];
}

/** Zone: free-form assessment prose. */
export interface ZoneAssessment {
  kind: 'assessment';
  text: string;
}

/** Zone: timeline of dated events. */
export interface ZoneTimeline {
  kind: 'timeline';
  entries: { date: string; note: string; source: string }[];
}

/** Discriminated union of all zone types. */
export type Zone = ZoneKeyFacts | ZoneRelationships | ZoneAssessment | ZoneTimeline;

/**
 * A Mimir page — the compiled-truth record for a knowledge entity.
 *
 * Richer than the legacy MimirPage: includes page type, confidence, multi-mount
 * provenance, related slugs, and structured zones.
 */
export interface Page {
  path: string;
  title: string;
  type: PageType;
  confidence: PageConfidence;
  /** Entity kind when type === 'entity' (person, org, concept, …). */
  entityType?: string;
  category: string;
  summary: string;
  /** Names of the mounts that carry this page. */
  mounts: string[];
  updatedAt: string;
  /** Ravn id that last wrote this page. */
  updatedBy: string;
  sourceIds: string[];
  /** Slugs of related pages (wikilinks). */
  related: string[];
  /** Size in bytes of the compiled content. */
  size: number;
  zones?: Zone[];
}

/** Origin channel of a raw ingest record. */
export type SourceOrigin = 'web' | 'rss' | 'arxiv' | 'file' | 'mail' | 'chat';

/** A raw ingest record — the original content before zone compilation. */
export interface Source {
  id: string;
  origin: SourceOrigin;
  url?: string;
  path?: string;
  ingestedAt: string;
  /** Ravn id that ran the ingest. */
  ingestAgent: string;
  /** Page paths that this source was compiled into. */
  compiledInto: string[];
  content?: string;
}

/** A typed entity extracted from page knowledge. */
export interface Entity {
  path: string;
  title: string;
  /** Entity kind (person, org, concept, project, …). */
  entityType: string;
  summary: string;
  relationshipCount: number;
}

/**
 * Lint rule codes L01–L12.
 *
 * - L01: contradictions between zones
 * - L02: stale source reference
 * - L03: duplicate page
 * - L04: missing required zone
 * - L05: broken wikilink
 * - L06: circular relationship
 * - L07: orphan page (no inbound links)
 * - L08: confidence mismatch
 * - L09: entity without type
 * - L10: timeline out of order
 * - L11: stale index
 * - L12: invalid frontmatter
 */
export type LintRule =
  | 'L01'
  | 'L02'
  | 'L03'
  | 'L04'
  | 'L05'
  | 'L06'
  | 'L07'
  | 'L08'
  | 'L09'
  | 'L10'
  | 'L11'
  | 'L12';

/** A lint issue found in a Mimir page. */
export interface LintIssue {
  id: string;
  rule: LintRule;
  severity: LintSeverity;
  message: string;
  pagePath: string;
  mount: string;
  assignee?: string;
  /** Whether the lint engine can apply an automatic fix. */
  autoFix: boolean;
  suggestedFix?: string;
}

/** Aggregated lint report across checked pages. */
export interface LintReport {
  issues: LintIssue[];
  pagesChecked: number;
  issuesFound: boolean;
  summary: { error: number; warning: number; info: number };
}

/** Outcome summary of a completed dream-cycle run. */
export interface DreamCycleSummary {
  pagesUpdated: number;
  entitiesCreated: number;
  lintFixes: number;
}

/** A single dream-cycle run record. */
export interface DreamCycle {
  id: string;
  /** Ravn id that ran this dream cycle. */
  ravnId: string;
  mounts: string[];
  startedAt: string;
  endedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
  summary: DreamCycleSummary;
  /** Human-readable changelog entries for this run. */
  changelog: string[];
}

/** Search mode for the embedding / FTS store. */
export type SearchMode = 'fts' | 'semantic' | 'hybrid';

/** Write-routing rule: path prefix → target mount names. */
export interface RoutingRule {
  prefix: string;
  mounts: string[];
}
