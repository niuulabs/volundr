import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { HelloPage } from './ui/HelloPage';
import { ShowcasePage } from './ui/ShowcasePage';

export const helloPlugin = definePlugin({
  id: 'hello',
  rune: 'ᚺ',
  title: 'Hello',
  subtitle: 'smoke test plugin',
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/hello',
      component: HelloPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/hello/showcase',
      component: ShowcasePage,
    }),
  ],
});

export { createMockHelloService } from './adapters/mock';
export { createHttpHelloService } from './adapters/http';
export type { IHelloService, Greeting } from './ports';
