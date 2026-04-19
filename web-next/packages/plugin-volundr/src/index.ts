import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { VolundrPage } from './ui/VolundrPage';

export const volundrPlugin = definePlugin({
  id: 'volundr',
  rune: 'ᚲ',
  title: 'Völundr',
  subtitle: 'session forge',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/volundr',
      component: VolundrPage,
    }),
  ],
});

// Adapters
export { createMockVolundrService } from './adapters/mock';
export { createMockClusterAdapter } from './adapters/mock';
export { createMockSessionStore } from './adapters/mock';
export { createMockTemplateStore } from './adapters/mock';
export { createMockPtyStream } from './adapters/mock';
export { createMockMetricsStream } from './adapters/mock';
export { buildVolundrHttpAdapter } from './adapters/http';

// Port types
export type { IVolundrService } from './ports/IVolundrService';
export type { IClusterAdapter } from './ports/IClusterAdapter';
export type { ISessionStore, SessionFilters } from './ports/ISessionStore';
export type { ITemplateStore } from './ports/ITemplateStore';
export type { IPtyStream } from './ports/IPtyStream';
export type { IMetricsStream, MetricPoint } from './ports/IMetricsStream';

// Domain types
export type { Session, SessionState, SessionResources, SessionEvent } from './domain/session';
export { canTransition, transitionSession } from './domain/session';
export type { PodSpec, Mount, MountSource, ResourceSpec, MountKind } from './domain/pod';
export type { Template } from './domain/template';
export type { Cluster, ClusterNode, ClusterCapacity, NodeStatus } from './domain/cluster';
export type { Quota, QuotaLimit, QuotaScope } from './domain/quota';

// Model types (lifted from web/)
export type {
  VolundrSession,
  VolundrStats,
  SessionStatus,
  VolundrFeatures,
  VolundrMessage,
  VolundrLog,
  VolundrTemplate,
  VolundrPreset,
  SessionChronicle,
  PullRequest,
  MergeResult,
  CIStatusValue,
  PersonalAccessToken,
  CreatePATResult,
  StoredCredential,
  SecretType,
  SessionSource,
} from './models/volundr.model';
