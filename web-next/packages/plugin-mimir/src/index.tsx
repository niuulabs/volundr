import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { MimirPage } from './ui/MimirPage';
import { SearchPage } from './ui/SearchPage';
import { GraphPage } from './ui/GraphPage';
import { EntitiesPage } from './ui/EntitiesPage';

export const mimirPlugin = definePlugin({
  id: 'mimir',
  rune: 'ᛗ',
  title: 'Mímir',
  subtitle: 'the well of knowledge',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/mimir',
      component: MimirPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/mimir/search',
      component: SearchPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/mimir/graph',
      component: GraphPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/mimir/entities',
      component: EntitiesPage,
    }),
  ],
});

export { createMimirMockAdapter } from './adapters/mock';
export { buildMimirHttpAdapter } from './adapters/http';
export type {
  IMimirService,
  IMountAdapter,
  IPageStore,
  IEmbeddingStore,
  ILintEngine,
  SearchMode,
  EmbeddingSearchResult,
} from './ports';
export type {
  PageType,
  Confidence,
  Zone,
  ZoneKind,
  ZoneKeyFacts,
  ZoneRelationships,
  ZoneAssessment,
  ZoneTimeline,
  PageMeta,
  Page,
  SearchResult,
} from './domain/page';
export type { LintRule, IssueSeverity, LintIssue, LintReport, DreamCycle } from './domain/lint';
export type { Source, OriginType } from './domain/source';
export type { EntityKind, EntityMeta } from './domain/entity';
