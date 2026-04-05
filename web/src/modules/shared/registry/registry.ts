/**
 * Module registry — maps feature keys to lazy-loaded React components.
 *
 * To add a new module:
 * 1. Create `modules/<name>/register.ts`
 * 2. Call `registerModuleDefinition()` with a `ModuleDefinition`
 * 3. Import your register file in `modules/index.ts`
 *
 * The Admin and Settings pages dynamically load modules from this registry
 * based on the feature catalog returned by the backend.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleDefinition } from './types';

// ── Legacy module registry (settings/admin sections) ──────────────

/** @deprecated Use ModuleDefinition.sections instead */
export interface ModuleEntry {
  key: string;
  load: () => Promise<{ default: ComponentType }>;
  icon: LucideIcon;
}

const registry = new Map<string, ModuleEntry>();

/** @deprecated Use registerModuleDefinition() instead */
export function registerModule(entry: ModuleEntry): void {
  registry.set(entry.key, entry);
}

export function getModule(key: string): ModuleEntry | undefined {
  return registry.get(key);
}

export function getAllModules(): Map<string, ModuleEntry> {
  return registry;
}

// ── Legacy product module registry ─────────────────────────────────

/** @deprecated Use ModuleDefinition instead */
export interface ProductModule {
  key: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  load: () => Promise<{ default: ComponentType }>;
}

const productRegistry: ProductModule[] = [];

/** @deprecated Use registerModuleDefinition() instead */
export function registerProductModule(entry: ProductModule): void {
  productRegistry.push(entry);
}

export function getProductModules(): ProductModule[] {
  return productRegistry;
}

// ── Module definition registry (new) ───────────────────────────────

const moduleDefinitions = new Map<string, ModuleDefinition>();

/**
 * Register a module definition.
 *
 * This is the primary registration API. It populates the new module
 * definition registry AND the legacy registries for backward compat.
 */
export function registerModuleDefinition(def: ModuleDefinition): void {
  moduleDefinitions.set(def.key, def);

  // Populate legacy product module registry
  const firstRoute = def.routes.find(r => r.load);
  registerProductModule({
    key: def.key,
    label: def.label,
    icon: def.icon,
    basePath: def.basePath,
    load:
      def.layout ??
      firstRoute?.load ??
      (() => Promise.resolve({ default: (() => null) as ComponentType })),
  });

  // Populate legacy feature module registry for settings/admin sections
  for (const section of def.sections ?? []) {
    registerModule({
      key: section.key,
      load: section.load,
      icon: section.icon,
    });
  }
}

export function getModuleDefinitions(): ModuleDefinition[] {
  return Array.from(moduleDefinitions.values());
}

export function getModuleDefinition(key: string): ModuleDefinition | undefined {
  return moduleDefinitions.get(key);
}
