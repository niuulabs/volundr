import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRoute,
  type RouterHistory,
} from '@tanstack/react-router';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';
import { ShellLayout } from './ShellLayout';
import { NotFound } from './NotFound';

export interface ComposeRoutesOptions {
  history?: RouterHistory;
}

export function composeRoutes(plugins: PluginDescriptor[], options?: ComposeRoutesOptions) {
  const rootRoute = createRootRoute({
    component: ShellLayout,
    notFoundComponent: NotFound,
  });

  const childRoutes: AnyRoute[] = [];

  for (const plugin of plugins) {
    if (plugin.routes) {
      childRoutes.push(...plugin.routes(rootRoute));
      continue;
    }

    if (plugin.render) {
      const renderFn = plugin.render;
      childRoutes.push(
        createRoute({
          getParentRoute: () => rootRoute,
          path: `/${plugin.id}`,
          component: () => renderFn({ tweaks: {}, setTweak: () => {} }),
        }),
      );
    }
  }

  const defaultId = resolveDefaultPlugin(plugins);
  if (defaultId) {
    const pluginIds = new Set(plugins.map((p) => p.id));
    childRoutes.unshift(
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        beforeLoad: () => {
          const stored = typeof window !== 'undefined' ? localStorage.getItem('niuu.active') : null;
          const target = stored && pluginIds.has(stored) ? stored : defaultId;
          throw redirect({ to: `/${target}` });
        },
      }),
    );
  }

  const routeTree = rootRoute.addChildren(childRoutes);
  return createRouter({ routeTree, ...options });
}

function resolveDefaultPlugin(plugins: PluginDescriptor[]): string | undefined {
  return plugins[0]?.id;
}
