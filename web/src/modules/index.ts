/**
 * Module registrations — imports all module register files at startup.
 *
 * Each module declares its own routes and sections in its register.ts
 * file via `registerModuleDefinition()`. To add a new module,
 * add one import line here.
 */
import './volundr/register';
import './tyr/register';
import './ravn/register';

// Re-export registry utilities
export { getModule, getAllModules, registerModule } from './shared/registry';
export { registerProductModule, getProductModules } from './shared/registry';
export {
  registerModuleDefinition,
  getModuleDefinitions,
  getModuleDefinition,
} from './shared/registry';
export type { ModuleEntry, ProductModule } from './shared/registry';
export type { ModuleDefinition, ModuleRoute, ModuleSection } from './shared/registry';
export { resolveIcon } from './shared/registry';
