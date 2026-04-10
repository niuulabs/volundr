import {
  Users,
  Building2,
  HardDrive,
  Cpu,
  ToggleLeft,
  ShieldCheck,
  KeyRound,
  Link2,
  Palette,
  LayoutDashboard,
} from 'lucide-react';
import { registerModuleDefinition } from '@/modules/shared/registry';
import { KenazRune } from '@/modules/shared/registry/rune-icons';

registerModuleDefinition({
  key: 'volundr',
  label: 'V\u00f6lundr',
  icon: KenazRune,
  basePath: '/volundr',
  routes: [
    {
      path: '',
      load: () => import('./pages/Volundr').then(m => ({ default: m.VolundrPage })),
    },
  ],
  sections: [
    // Admin sections
    {
      key: 'users',
      scope: 'admin',
      icon: Users,
      load: () =>
        import('./pages/Admin/sections/UsersSection').then(m => ({
          default: m.UsersSection,
        })),
    },
    {
      key: 'tenants',
      scope: 'admin',
      icon: Building2,
      load: () =>
        import('./pages/Admin/sections/TenantsSection').then(m => ({
          default: m.TenantsSection,
        })),
    },
    {
      key: 'storage',
      scope: 'admin',
      icon: HardDrive,
      load: () =>
        import('./pages/Admin/sections/StorageSection').then(m => ({
          default: m.StorageSection,
        })),
    },
    {
      key: 'resources',
      scope: 'admin',
      icon: Cpu,
      load: () =>
        import('./pages/Admin/sections/ResourcesSection').then(m => ({
          default: m.ResourcesSection,
        })),
    },
    {
      key: 'feature-management',
      scope: 'admin',
      icon: ToggleLeft,
      load: () =>
        import('./pages/Admin/sections/FeatureManagementSection').then(m => ({
          default: m.FeatureManagementSection,
        })),
    },
    // User settings sections
    {
      key: 'tokens',
      scope: 'settings',
      icon: ShieldCheck,
      load: () =>
        import('./pages/Settings/sections/AccessTokensSection').then(m => ({
          default: m.AccessTokensSection,
        })),
    },
    {
      key: 'credentials',
      scope: 'settings',
      icon: KeyRound,
      load: () =>
        import('./pages/Settings/sections/CredentialsSection').then(m => ({
          default: m.CredentialsSection,
        })),
    },
    {
      key: 'workspaces',
      scope: 'settings',
      icon: HardDrive,
      load: () =>
        import('./pages/Settings/sections/WorkspacesSection').then(m => ({
          default: m.WorkspacesSection,
        })),
    },
    {
      key: 'integrations',
      scope: 'settings',
      icon: Link2,
      load: () =>
        import('./pages/Settings/sections/IntegrationsSection').then(m => ({
          default: m.IntegrationsSection,
        })),
    },
    {
      key: 'appearance',
      scope: 'settings',
      icon: Palette,
      load: () =>
        import('./pages/Settings/sections/AppearanceSection').then(m => ({
          default: m.AppearanceSection,
        })),
    },
    {
      key: 'layout',
      scope: 'settings',
      icon: LayoutDashboard,
      load: () =>
        import('./pages/Settings/sections/LayoutSection').then(m => ({
          default: m.LayoutSection,
        })),
    },
  ],
});
