import { createRoute } from '@tanstack/react-router';
import { helloPlugin } from '@niuulabs/plugin-hello';
import { definePlugin, type PluginDescriptor } from '@niuulabs/plugin-sdk';
import { ShowcasePage } from './showcase/ShowcasePage';

const showcasePlugin = definePlugin({
  id: 'showcase',
  rune: 'ᛊ',
  title: 'Showcase',
  subtitle: 'NIU-658 data surfaces',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/showcase',
      component: ShowcasePage,
    }),
  ],
});

export const plugins: PluginDescriptor[] = [helloPlugin, showcasePlugin];
