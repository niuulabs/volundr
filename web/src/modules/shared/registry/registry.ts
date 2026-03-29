/**
 * Module registry — maps feature keys to lazy-loaded React components.
 *
 * To add a new module:
 * 1. Create the component (e.g. `pages/Admin/sections/MySection.tsx`)
 * 2. Call `registerModule()` in `modules/index.ts`
 * 3. Add the feature to `config.yaml` under `features:`
 *
 * The Admin and Settings pages dynamically load modules from this registry
 * based on the feature catalog returned by the backend.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { IVolundrService } from '@/ports';

export interface ModuleEntry {
  key: string;
  load: () => Promise<{ default: ComponentType<{ service: IVolundrService }> }>;
  icon: LucideIcon;
}

const registry = new Map<string, ModuleEntry>();

export function registerModule(entry: ModuleEntry): void {
  registry.set(entry.key, entry);
}

export function getModule(key: string): ModuleEntry | undefined {
  return registry.get(key);
}

export function getAllModules(): Map<string, ModuleEntry> {
  return registry;
}

// ── Product module registry ─────────────────────────────────────────

export interface ProductModule {
  key: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  load: () => Promise<{ default: ComponentType }>;
}

const productRegistry: ProductModule[] = [];

export function registerProductModule(entry: ProductModule): void {
  productRegistry.push(entry);
}

export function getProductModules(): ProductModule[] {
  return productRegistry;
}
