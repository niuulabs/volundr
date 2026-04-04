import { Compass } from 'lucide-react';
import { registerModuleDefinition } from '@/modules/shared/registry';

registerModuleDefinition({
  key: 'tyr',
  label: 'Tyr',
  icon: Compass,
  basePath: '/tyr',
  layout: () => import('./pages/TyrLayout').then(m => ({ default: m.TyrLayout })),
  routes: [
    { path: '', index: true, redirectTo: 'dashboard' },
    {
      path: 'dashboard',
      load: () => import('./pages/DashboardView').then(m => ({ default: m.DashboardView })),
    },
    {
      path: 'sagas',
      load: () => import('./pages/SagasView').then(m => ({ default: m.SagasView })),
    },
    {
      path: 'sagas/:id',
      load: () => import('./pages/DetailView').then(m => ({ default: m.DetailView })),
    },
    {
      path: 'new',
      load: () => import('./pages/PlanSagaView').then(m => ({ default: m.PlanSagaView })),
    },
    {
      path: 'import',
      load: () => import('./pages/ImportView').then(m => ({ default: m.ImportView })),
    },
    {
      path: 'dispatcher',
      load: () => import('./pages/DispatcherView').then(m => ({ default: m.DispatcherView })),
    },
    {
      path: 'sessions',
      load: () => import('./pages/SessionsView').then(m => ({ default: m.SessionsView })),
    },
    { path: 'plan', redirectTo: '/tyr/new' },
    { path: 'settings', redirectTo: '/settings' },
  ],
  sections: [
    {
      key: 'tyr-connections',
      scope: 'settings',
      icon: Compass,
      load: () =>
        import('./pages/Settings/TyrConnectionsWrapper').then(m => ({
          default: m.TyrConnectionsWrapper,
        })),
    },
  ],
  proxies: [
    {
      path: '/api/v1/tyr',
      targetEnvVar: 'VITE_TYR_API_TARGET',
      defaultTarget: 'http://localhost:8081',
    },
  ],
});
