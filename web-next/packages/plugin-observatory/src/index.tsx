import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ui/ObservatoryPage';
import { RegistryPage } from './ui/RegistryPage';

export const observatoryPlugin = definePlugin({
  id: 'observatory',
  rune: 'ᚠ',
  title: 'Observatory',
  subtitle: 'live topology · registry',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/observatory',
      component: ObservatoryPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/registry',
      component: RegistryPage,
    }),
  ],
});

export {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
} from './adapters/mock';
export {
  buildObservatoryRegistryHttpAdapter,
  buildObservatoryTopologySseStream,
  buildObservatoryEventsSseStream,
} from './adapters/http';
export type { IRegistryRepository, ILiveTopologyStream, IEventStream } from './ports';
export type {
  EntityType,
  EntityTypeField,
  EntityShape,
  EntityCategory,
  Registry,
  EdgeKind,
  NodeStatus,
  TopologyNode,
  TopologyEdge,
  Topology,
  Realm,
  Cluster,
  Host,
  Raid,
  EventSeverity,
  ObservatoryEvent,
} from './domain';
