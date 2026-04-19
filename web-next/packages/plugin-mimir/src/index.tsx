import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { MimirPage } from './ui/MimirPage';

export const mimirPlugin = definePlugin({
  id: 'mimir',
  rune: 'ᛗ',
  title: 'Mímir',
  subtitle: 'the well of knowledge',
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/mimir',
      component: MimirPage,
    }),
  ],
});

export { createMockMimirService } from './adapters/mock';
export { createHttpMimirService } from './adapters/http';
export type { IMimirService } from './ports/IMimirService';
export type { IMountAdapter } from './ports/IMountAdapter';
export type { IPageStore, ListPagesOpts } from './ports/IPageStore';
export type { IEmbeddingStore, SearchOpts } from './ports/IEmbeddingStore';
export type { ILintEngine } from './ports/ILintEngine';

// Domain types
export type {
  Mount,
  MountRole,
  MountStatus,
  MimirPageMeta,
  MimirPage,
  MimirStats,
  MimirSearchResult,
  LintSeverity,
  MimirLogEntry,
  GraphNode,
  GraphEdge,
  MimirGraph,
  IngestStatus,
  IngestSourceType,
  IngestJob,
  IngestRequest,
  IngestResponse,
  PageType,
  PageConfidence,
  ZoneKeyFacts,
  ZoneRelationships,
  ZoneAssessment,
  ZoneTimeline,
  Zone,
  Page,
  SourceOrigin,
  Source,
  Entity,
  LintRule,
  LintIssue,
  LintReport,
  DreamCycleSummary,
  DreamCycle,
  SearchMode,
  RoutingRule,
} from './domain/types';

export { transitionJob, isTerminal } from './domain/types';
