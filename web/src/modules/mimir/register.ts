import { registerModuleDefinition } from '@/modules/shared/registry';
import { MannazRune } from '@/modules/shared/registry/rune-icons';

registerModuleDefinition({
  key: 'mimir',
  label: 'Mímir',
  icon: MannazRune,
  basePath: '/mimir',
  layout: () => import('./pages/MimirLayout').then(m => ({ default: m.MimirLayout })),
  routes: [
    { path: '', index: true, redirectTo: 'browse' },
    {
      path: 'browse',
      load: () => import('./pages/BrowseView').then(m => ({ default: m.BrowseView })),
    },
    {
      path: 'graph',
      load: () => import('./pages/GraphView').then(m => ({ default: m.GraphView })),
    },
    {
      path: 'ingest',
      load: () => import('./pages/IngestView').then(m => ({ default: m.IngestView })),
    },
    {
      path: 'log',
      load: () => import('./pages/LogView').then(m => ({ default: m.LogView })),
    },
    {
      path: 'lint',
      load: () => import('./pages/LintView').then(m => ({ default: m.LintView })),
    },
  ],
});
