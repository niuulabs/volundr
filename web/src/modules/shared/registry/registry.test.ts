import { describe, it, expect } from 'vitest';
import { Settings } from 'lucide-react';
import type { IVolundrService } from '@/ports';
import {
  registerModule,
  getModule,
  getAllModules,
  registerProductModule,
  getProductModules,
} from './registry';

const dummyLoad = () =>
  Promise.resolve({
    default: (() => null) as unknown as React.ComponentType<{ service: IVolundrService }>,
  });

describe('Module Registry', () => {
  it('registers and retrieves a module', () => {
    registerModule({ key: 'test-module', load: dummyLoad, icon: Settings });

    const entry = getModule('test-module');
    expect(entry).toBeDefined();
    expect(entry!.key).toBe('test-module');
    expect(entry!.icon).toBe(Settings);
  });

  it('returns undefined for unregistered key', () => {
    const entry = getModule('nonexistent-module');
    expect(entry).toBeUndefined();
  });

  it('getAllModules returns all registered modules', () => {
    registerModule({ key: 'reg-test-a', load: dummyLoad, icon: Settings });
    registerModule({ key: 'reg-test-b', load: dummyLoad, icon: Settings });

    const all = getAllModules();
    expect(all.has('reg-test-a')).toBe(true);
    expect(all.has('reg-test-b')).toBe(true);
  });

  it('overwrites existing registration with same key', () => {
    const loadA = () =>
      Promise.resolve({
        default: (() => 'A') as unknown as React.ComponentType<{ service: IVolundrService }>,
      });
    const loadB = () =>
      Promise.resolve({
        default: (() => 'B') as unknown as React.ComponentType<{ service: IVolundrService }>,
      });

    registerModule({ key: 'overwrite-test', load: loadA, icon: Settings });
    registerModule({ key: 'overwrite-test', load: loadB, icon: Settings });

    const entry = getModule('overwrite-test');
    expect(entry!.load).toBe(loadB);
  });
});

describe('Product Module Registry', () => {
  it('registers and retrieves a product module', () => {
    const dummyProductLoad = () =>
      Promise.resolve({ default: (() => null) as unknown as React.ComponentType });

    registerProductModule({
      key: 'test-product',
      label: 'Test Product',
      icon: Settings,
      basePath: '/test',
      load: dummyProductLoad,
    });

    const modules = getProductModules();
    const found = modules.find(m => m.key === 'test-product');
    expect(found).toBeDefined();
    expect(found!.label).toBe('Test Product');
    expect(found!.basePath).toBe('/test');
    expect(found!.icon).toBe(Settings);
  });

  it('returns all registered product modules', () => {
    const dummyProductLoad = () =>
      Promise.resolve({ default: (() => null) as unknown as React.ComponentType });

    registerProductModule({
      key: 'product-a',
      label: 'Product A',
      icon: Settings,
      basePath: '/a',
      load: dummyProductLoad,
    });
    registerProductModule({
      key: 'product-b',
      label: 'Product B',
      icon: Settings,
      basePath: '/b',
      load: dummyProductLoad,
    });

    const modules = getProductModules();
    expect(modules.some(m => m.key === 'product-a')).toBe(true);
    expect(modules.some(m => m.key === 'product-b')).toBe(true);
  });
});
