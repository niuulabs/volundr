/**
 * Module registrations — registers all built-in feature modules.
 *
 * Import this file once at app startup to populate the registry.
 * Each registration maps a feature key to its lazy-loaded component + icon.
 */
import type { ComponentType } from 'react';
import {
  Users,
  Building2,
  HardDrive,
  Cpu,
  KeyRound,
  Link2,
  Palette,
  ToggleLeft,
  LayoutDashboard,
} from 'lucide-react';
import type { IVolundrService } from '@/ports';
import { registerModule } from './registry';

type ModuleComponent = ComponentType<{ service: IVolundrService }>;

// ── Admin modules ──────────────────────────────────────────────────

registerModule({
  key: 'users',
  load: () =>
    import('@/pages/Admin/sections/UsersSection').then(m => ({
      default: m.UsersSection,
    })),
  icon: Users,
});

registerModule({
  key: 'tenants',
  load: () =>
    import('@/pages/Admin/sections/TenantsSection').then(m => ({
      default: m.TenantsSection,
    })),
  icon: Building2,
});

registerModule({
  key: 'storage',
  load: () =>
    import('@/pages/Admin/sections/StorageSection').then(m => ({
      default: m.StorageSection,
    })),
  icon: HardDrive,
});

registerModule({
  key: 'resources',
  load: () =>
    import('@/pages/Admin/sections/ResourcesSection').then(m => ({
      default: m.ResourcesSection,
    })),
  icon: Cpu,
});

registerModule({
  key: 'feature-management',
  load: () =>
    import('@/pages/Admin/sections/FeatureManagementSection').then(m => ({
      default: m.FeatureManagementSection,
    })),
  icon: ToggleLeft,
});

// ── User modules ───────────────────────────────────────────────────

registerModule({
  key: 'credentials',
  load: () =>
    import('@/pages/Settings/sections/CredentialsSection').then(m => ({
      default: m.CredentialsSection,
    })),
  icon: KeyRound,
});

registerModule({
  key: 'workspaces',
  load: () =>
    import('@/pages/Settings/sections/WorkspacesSection').then(m => ({
      default: m.WorkspacesSection,
    })),
  icon: HardDrive,
});

registerModule({
  key: 'integrations',
  load: () =>
    import('@/pages/Settings/sections/IntegrationsSection').then(m => ({
      default: m.IntegrationsSection,
    })),
  icon: Link2,
});

registerModule({
  key: 'appearance',
  load: () =>
    import('@/pages/Settings/sections/AppearanceSection').then(
      // AppearanceSection ignores the service prop — cast is safe
      m => ({ default: m.AppearanceSection as unknown as ModuleComponent })
    ),
  icon: Palette,
});

registerModule({
  key: 'layout',
  load: () =>
    import('@/pages/Settings/sections/LayoutSection').then(m => ({
      default: m.LayoutSection,
    })),
  icon: LayoutDashboard,
});

// Re-export registry utilities
export { getModule, getAllModules, registerModule } from './registry';
export type { ModuleEntry } from './registry';
export { resolveIcon } from './icons';
