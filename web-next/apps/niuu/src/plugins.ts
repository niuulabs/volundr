import { helloPlugin } from '@niuulabs/plugin-hello';
import { observatoryPlugin } from '@niuulabs/plugin-observatory';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [helloPlugin, observatoryPlugin];
