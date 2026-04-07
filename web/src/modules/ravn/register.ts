import { Bird } from 'lucide-react';
import { registerModuleDefinition } from '@/modules/shared/registry';

registerModuleDefinition({
  key: 'ravn',
  label: 'Ravn',
  icon: Bird,
  basePath: '/ravn',
  routes: [
    { path: '', index: true, redirectTo: 'chat' },
    {
      path: 'chat',
      load: () => import('./pages/ChatView').then(m => ({ default: m.ChatView })),
    },
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
