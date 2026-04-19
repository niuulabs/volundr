import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ui/ObservatoryPage';

export const observatoryPlugin = definePlugin({
  id: 'observatory',
  rune: 'ᚠ',
  title: 'Flokk · Observatory',
  subtitle: 'live topology & entity registry',
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/observatory',
      component: ObservatoryPage,
    }),
  ],
});

export {
  createMockRegistryRepository,
  createMockLiveTopologyStream,
  createMockEventStream,
} from './adapters/mock';

export type { IRegistryRepository } from './ports/IRegistryRepository';
export type { ILiveTopologyStream } from './ports/ILiveTopologyStream';
export type { IEventStream } from './ports/IEventStream';

export type { TypeRegistry } from './domain/registry';
export type {
  TopologyEntity,
  TopologySnapshot,
  EntityStatus,
  Realm,
  Cluster,
  Host,
  Raid,
} from './domain/topology';
export type { ConnectionKind, Connection } from './domain/connections';
export type { ObservatoryEvent, EventSource } from './domain/events';

export { TopologyCanvas } from './ui/TopologyCanvas';
export type { TopologyCanvasProps } from './ui/TopologyCanvas';
