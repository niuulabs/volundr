import { helloPlugin } from '@niuulabs/plugin-hello';
import { volundrPlugin } from '@niuulabs/plugin-volundr';
import { observatoryPlugin } from '@niuulabs/plugin-observatory';
import { ravnPlugin } from '@niuulabs/plugin-ravn';
import type { PluginDescriptor } from '@niuulabs/plugin-sdk';

export const plugins: PluginDescriptor[] = [helloPlugin, volundrPlugin, observatoryPlugin, ravnPlugin];
