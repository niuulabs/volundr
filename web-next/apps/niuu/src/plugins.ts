import { helloPlugin } from '@niuulabs/plugin-hello';
import { ravnPlugin } from '@niuulabs/plugin-ravn';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [helloPlugin, ravnPlugin];
