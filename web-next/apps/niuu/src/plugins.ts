import { helloPlugin } from '@niuulabs/plugin-hello';
import { volundrPlugin } from '@niuulabs/plugin-volundr';
import { observatoryPlugin } from '@niuulabs/plugin-observatory';
import { ravnPlugin } from '@niuulabs/plugin-ravn';
import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';
import { ShowcasePage } from './ShowcasePage';

const showcasePlugin = definePlugin({
  id: 'showcase',
  rune: 'ᚲ',
  title: 'Showcase',
  subtitle: 'NIU-654 composites',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/showcase',
      component: ShowcasePage,
    }),
  ],
});

export const plugins: PluginDescriptor[] = [
  helloPlugin,
  volundrPlugin,
  observatoryPlugin,
  ravnPlugin,
  showcasePlugin,
];
