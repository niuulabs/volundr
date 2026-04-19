import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { HelloPage } from './ui/HelloPage';
import { StatusShowcasePage } from './ui/StatusShowcasePage';

export const helloPlugin = definePlugin({
  id: 'hello',
  rune: 'ᚺ',
  title: 'Hello',
  subtitle: 'smoke test plugin',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/hello',
      component: HelloPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/hello/status-showcase',
      component: StatusShowcasePage,
    }),
  ],
});

export { createMockHelloService } from './adapters/mock';
export { buildHelloHttpAdapter } from './adapters/http';
export type { IHelloService, Greeting } from './ports';
