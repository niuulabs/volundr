import type { TypeRegistry } from '../domain/registry';

export interface IRegistryRepository {
  loadRegistry(): Promise<TypeRegistry>;
  saveRegistry(registry: TypeRegistry): Promise<void>;
}
