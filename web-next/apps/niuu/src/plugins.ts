import { helloPlugin } from '@niuulabs/plugin-hello';
import { loginPlugin } from '@niuulabs/plugin-login';
import { mimirPlugin } from '@niuulabs/plugin-mimir';
import { observatoryPlugin } from '@niuulabs/plugin-observatory';
import { ravnPlugin } from '@niuulabs/plugin-ravn';
import { volundrPlugin } from '@niuulabs/plugin-volundr';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [
  loginPlugin,
  helloPlugin,
  volundrPlugin,
  observatoryPlugin,
  ravnPlugin,
  mimirPlugin,
];
