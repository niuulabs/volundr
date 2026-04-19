import { helloPlugin } from '@niuulabs/plugin-hello';
import { volundrPlugin } from '@niuulabs/plugin-volundr';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [helloPlugin, volundrPlugin];
