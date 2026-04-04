/**
 * Module contract — the formal interface every UI module must implement.
 *
 * To add a new module:
 * 1. Create `modules/<name>/register.ts`
 * 2. Call `registerModuleDefinition()` with a `ModuleDefinition`
 * 3. Import your register file in `modules/index.ts`
 *
 * Routes, settings sections, and dev-proxy entries are all declared here.
 * The shell discovers everything from the registry — no edits to App.tsx
 * or vite.config.ts required.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * A single route within a module.
 * Paths are relative to the module's `basePath`.
 */
export interface ModuleRoute {
  /** Route path relative to basePath, e.g. "sagas/:id" */
  path: string;
  /** Lazy loader for the route component */
  load?: () => Promise<{ default: ComponentType }>;
  /** Mark as the index route (renders at the bare basePath) */
  index?: boolean;
  /** Redirect to another path instead of rendering a component */
  redirectTo?: string;
}

/**
 * A settings or admin section contributed by a module.
 */
export interface ModuleSection {
  /** Unique key matching the backend feature catalog entry */
  key: string;
  /** Which page this section appears on */
  scope: 'settings' | 'admin';
  /** Icon shown in the section sidebar */
  icon: LucideIcon;
  /** Lazy loader for the section component (no props required) */
  load: () => Promise<{ default: ComponentType }>;
}

/**
 * Dev-server proxy entry for a module's backend API.
 * Consumed by the Vite proxy plugin at build time, ignored at runtime.
 */
export interface ModuleProxy {
  /** URL path prefix to proxy, e.g. "/api/v1/tyr" */
  path: string;
  /** Environment variable that overrides the target, e.g. "VITE_TYR_API_TARGET" */
  targetEnvVar: string;
  /** Default proxy target when the env var is not set */
  defaultTarget: string;
}

/**
 * The full definition of a UI module.
 *
 * Every module registers one of these at startup. The shell uses it to:
 * - Generate routes (layout + child routes, or flat routes)
 * - Populate the sidebar navigation
 * - Discover settings/admin sections
 * - Configure dev-server proxies
 */
export interface ModuleDefinition {
  /** Unique module identifier, e.g. "tyr" */
  key: string;
  /** Display name shown in sidebar and UI, e.g. "Tyr" */
  label: string;
  /** Sidebar icon */
  icon: LucideIcon;
  /** Base URL path, e.g. "/tyr" */
  basePath: string;
  /**
   * Optional layout component wrapping child routes (renders <Outlet/>).
   * Omit for single-page modules (like Volundr).
   */
  layout?: () => Promise<{ default: ComponentType }>;
  /** Route definitions relative to basePath */
  routes: ModuleRoute[];
  /** Settings and admin sections this module contributes */
  sections?: ModuleSection[];
  /** Dev-server proxy entries for this module's backend */
  proxies?: ModuleProxy[];
  /** Roles required to see this module in the sidebar (empty = visible to all) */
  requiredRoles?: string[];
}
