import { createRoute } from '@tanstack/react-router';
import { helloPlugin } from '@niuulabs/plugin-hello';
import { loginPlugin } from '@niuulabs/plugin-login';
import { ravnPlugin } from '@niuulabs/plugin-ravn';
import { mimirPlugin } from '@niuulabs/plugin-mimir';
import { observatoryPlugin } from '@niuulabs/plugin-observatory';
import { volundrPlugin } from '@niuulabs/plugin-volundr';
import { definePlugin, type PluginDescriptor } from '@niuulabs/plugin-sdk';
import { ShowcasePage } from './showcase/ShowcasePage';
import { UIShowcasePage } from './UIShowcasePage';

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

const uiShowcasePlugin = definePlugin({
  id: 'ui-showcase',
  rune: 'ᚢ',
  title: 'UI Showcase',
  subtitle: 'identity composites',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/ui-showcase',
      component: UIShowcasePage,
    }),
  ],
});

export const plugins: PluginDescriptor[] = [
  loginPlugin,
  helloPlugin,
  showcasePlugin,
  mimirPlugin,
  observatoryPlugin,
  ravnPlugin,
  volundrPlugin,
  uiShowcasePlugin,
];
