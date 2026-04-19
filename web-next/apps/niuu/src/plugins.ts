import { helloPlugin } from '@niuulabs/plugin-hello';
import { mimirPlugin } from '@niuulabs/plugin-mimir';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [helloPlugin, mimirPlugin];
