import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { MimirPage } from './ui/MimirPage';

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
  RecentWrite,
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
export type { FileTreeDir, FileTreeLeaf, FileTreeItem, WikilinkTarget, ZoneEditState, ZoneEditAction } from './domain';
export { buildFileTree, mergeFileTrees, resolveWikilink, detectBrokenWikilinks, zoneEditReducer } from './domain';

// UI components (plugin-local; promote to @niuulabs/ui when a second plugin needs them)
export { WikilinkPill } from './ui/components/WikilinkPill';
export { PageTypeGlyph } from './ui/components/PageTypeGlyph';
export { MountChip } from './ui/components/MountChip';
export { OverviewView } from './ui/OverviewView';
export { PagesView } from './ui/PagesView';
export { SourcesView } from './ui/SourcesView';
