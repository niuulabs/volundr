/**
 * Dynamic route generator — builds React Router routes from the module registry.
 *
 * Modules declare their routes in `register.ts` via `registerModuleDefinition()`.
 * This component reads the registry and generates `<Route>` elements, so
 * App.tsx never needs to be edited when adding a new module.
 */
import { lazy } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { getModuleDefinitions } from '@/modules/shared/registry';
import type { ModuleRoute } from '@/modules/shared/registry/types';

// Cache lazy components so React.lazy is only called once per loader
const lazyCache = new Map<() => Promise<{ default: React.ComponentType }>, React.ComponentType>();

function getLazy(load: () => Promise<{ default: React.ComponentType }>): React.ComponentType {
  if (lazyCache.has(load)) {
    return lazyCache.get(load)!;
  }
  const Component = lazy(load);
  lazyCache.set(load, Component);
  return Component;
}

function renderRoute(route: ModuleRoute, keyPrefix: string) {
  if (route.index && route.redirectTo) {
    return (
      <Route
        key={`${keyPrefix}-index`}
        index
        element={<Navigate to={route.redirectTo} replace />}
      />
    );
  }

  if (route.redirectTo) {
    return (
      <Route
        key={`${keyPrefix}-${route.path}`}
        path={route.path}
        element={<Navigate to={route.redirectTo} replace />}
      />
    );
  }

  if (!route.load) return null;

  const Page = getLazy(route.load);
  return (
    <Route
      key={`${keyPrefix}-${route.path}`}
      path={route.path || undefined}
      index={route.index}
      element={<Page />}
    />
  );
}

/**
 * Renders `<Route>` elements for all registered modules.
 * Must be used inside a `<Routes>` component.
 */
export function ModuleRoutes(): React.ReactElement[] {
  const definitions = getModuleDefinitions();

  return definitions.flatMap(def => {
    if (def.layout) {
      // Module with a layout: wrap child routes in a parent route
      const Layout = getLazy(def.layout);
      return [
        <Route key={def.key} path={def.basePath} element={<Layout />}>
          {def.routes.map(r => renderRoute(r, def.key))}
        </Route>,
      ];
    }

    // Single-page module (no layout): render routes directly under basePath
    if (def.routes.length === 1 && (def.routes[0].path === '' || !def.routes[0].path)) {
      const route = def.routes[0];
      if (!route.load) return [];
      const Page = getLazy(route.load);
      return [<Route key={def.key} path={def.basePath} element={<Page />} />];
    }

    // Multiple flat routes under basePath
    return [
      <Route key={def.key} path={def.basePath}>
        {def.routes.map(r => renderRoute(r, def.key))}
      </Route>,
    ];
  });
}
