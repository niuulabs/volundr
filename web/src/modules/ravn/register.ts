import { Bot } from 'lucide-react';
import { registerModuleDefinition } from '@/modules/shared/registry';

registerModuleDefinition({
  key: 'ravn',
  label: 'Ravn',
  icon: Bot,
  basePath: '/ravn',
  routes: [
    { path: '', index: true, redirectTo: 'sessions' },
    {
      path: 'sessions',
      load: () => import('./pages/SessionsView').then(m => ({ default: m.SessionsView })),
    },
    {
      path: 'config',
      load: () => import('./pages/AgentsView').then(m => ({ default: m.AgentsView })),
    },
  ],
});
