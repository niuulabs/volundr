import type { ReactNode } from 'react';
import type { AnyRoute } from '@tanstack/react-router';

export interface PluginCtx {
  tweaks: Record<string, unknown>;
  setTweak: (key: string, value: unknown) => void;
}

export interface PluginDescriptor {
  id: string;
  rune: string;
  title: string;
  subtitle: string;
  /** When true, the plugin's rune button is hidden from the shell rail nav. */
  navHidden?: boolean;

  routes?: (rootRoute: AnyRoute) => AnyRoute[];

  render?: (ctx: PluginCtx) => ReactNode;
  subnav?: (ctx: PluginCtx) => ReactNode;
  topbarRight?: (ctx: PluginCtx) => ReactNode;
}

export function definePlugin(descriptor: PluginDescriptor): PluginDescriptor {
  return descriptor;
}
