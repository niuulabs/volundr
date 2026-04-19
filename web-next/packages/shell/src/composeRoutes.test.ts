import { describe, it, expect, beforeEach } from 'vitest';
import { createRoute, createMemoryHistory } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { composeRoutes } from './composeRoutes';

function routePaths(router: ReturnType<typeof composeRoutes>): string[] {
  return router.routeTree.children?.map((r) => r.path) ?? [];
}

describe('composeRoutes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a router with no child routes for empty plugins', () => {
    const router = composeRoutes([], {
      history: createMemoryHistory({ initialEntries: ['/anything'] }),
    });
    expect(router).toBeDefined();
    expect(router.routeTree.children?.length ?? 0).toBe(0);
  });

  it('collects routes from a single plugin', () => {
    const plugin = definePlugin({
      id: 'alpha',
      rune: 'ᚨ',
      title: 'Alpha',
      subtitle: 'test',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/alpha' })],
    });

    const router = composeRoutes([plugin], {
      history: createMemoryHistory({ initialEntries: ['/alpha'] }),
    });

    const paths = routePaths(router);
    expect(paths).toContain('/');
    expect(paths).toContain('alpha');
  });

  it('collects routes from multiple plugins', () => {
    const alpha = definePlugin({
      id: 'alpha',
      rune: 'ᚨ',
      title: 'Alpha',
      subtitle: 'a',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/alpha' })],
    });

    const beta = definePlugin({
      id: 'beta',
      rune: 'ᛒ',
      title: 'Beta',
      subtitle: 'b',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/beta' })],
    });

    const router = composeRoutes([alpha, beta], {
      history: createMemoryHistory({ initialEntries: ['/alpha'] }),
    });

    const paths = routePaths(router);
    expect(paths).toContain('alpha');
    expect(paths).toContain('beta');
    expect(paths).toContain('/');
  });

  it('creates a render-fallback route for plugins with only render', () => {
    const legacy = definePlugin({
      id: 'legacy',
      rune: 'ᛚ',
      title: 'Legacy',
      subtitle: 'old',
      render: () => null,
    });

    const router = composeRoutes([legacy], {
      history: createMemoryHistory({ initialEntries: ['/legacy'] }),
    });

    const paths = routePaths(router);
    expect(paths).toContain('legacy');
  });

  it('sets a notFoundComponent on the root route', () => {
    const router = composeRoutes([], {
      history: createMemoryHistory({ initialEntries: ['/nope'] }),
    });

    expect(router.routeTree.options.notFoundComponent).toBeDefined();
  });

  it('creates an index route that redirects to the first plugin', async () => {
    const plugin = definePlugin({
      id: 'alpha',
      rune: 'ᚨ',
      title: 'Alpha',
      subtitle: 'test',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/alpha' })],
    });

    const router = composeRoutes([plugin], {
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    await router.load();
    expect(router.state.location.pathname).toBe('/alpha');
  });

  it('redirects index to localStorage-stored plugin when valid', async () => {
    localStorage.setItem('niuu.active', 'beta');

    const alpha = definePlugin({
      id: 'alpha',
      rune: 'ᚨ',
      title: 'Alpha',
      subtitle: 'a',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/alpha' })],
    });

    const beta = definePlugin({
      id: 'beta',
      rune: 'ᛒ',
      title: 'Beta',
      subtitle: 'b',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/beta' })],
    });

    const router = composeRoutes([alpha, beta], {
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    await router.load();
    expect(router.state.location.pathname).toBe('/beta');
  });

  it('ignores invalid localStorage value and falls back to first plugin', async () => {
    localStorage.setItem('niuu.active', 'nonexistent');

    const plugin = definePlugin({
      id: 'alpha',
      rune: 'ᚨ',
      title: 'Alpha',
      subtitle: 'test',
      routes: (root) => [createRoute({ getParentRoute: () => root, path: '/alpha' })],
    });

    const router = composeRoutes([plugin], {
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    await router.load();
    expect(router.state.location.pathname).toBe('/alpha');
  });
});
