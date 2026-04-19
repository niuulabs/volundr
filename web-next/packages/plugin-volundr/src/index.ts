import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { VolundrPage } from './ui/VolundrPage';

export const volundrPlugin = definePlugin({
  id: 'volundr',
  /** Kaunaz — torch / forge */
  rune: 'ᚲ',
  title: 'Völundr',
  subtitle: 'session forge',
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/volundr',
      component: VolundrPage,
    }),
  ],
});

// Domain
export type { SessionState, Session } from './domain/session';
export {
  canTransition,
  transition,
  isTerminalState,
  isActiveState,
  isProvisioningState,
  isReadyOrBeyond,
} from './domain/session';
export type { MountSourceKind, PodMount, ResourceSpec, PodSpec } from './domain/pod';
export type { Template } from './domain/template';
export type { NodeStatus, ClusterNode, ResourceCapacity, Cluster } from './domain/cluster';
export { availableCapacity, isClusterHealthy, nodeStatusCounts } from './domain/cluster';
export type { Quota, QuotaUsage } from './domain/quota';
export { isWithinQuota, remainingQuota, isOverQuota } from './domain/quota';

// Ports (type-only)
export type { IVolundrService } from './ports/IVolundrService';
export type { IClusterAdapter } from './ports/IClusterAdapter';
export type { ISessionStore } from './ports/ISessionStore';
export type { ITemplateStore } from './ports/ITemplateStore';
export type { IPtyStream, PtyOutput } from './ports/IPtyStream';
export type { IMetricsStream, SessionMetrics } from './ports/IMetricsStream';

// Adapters
export {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockSessionStore,
  createMockTemplateStore,
  createMockPtyStream,
  createMockMetricsStream,
  createMockVolundrServices,
} from './adapters/mock';

// Selected domain models (for consumers)
export type {
  VolundrSession,
  VolundrStats,
  VolundrFeatures,
  SessionStatus,
  SessionSource,
  GitSource,
  LocalMountSource,
  VolundrMessage,
  VolundrLog,
  VolundrModel,
  VolundrRepo,
  SessionChronicle,
  ChronicleEvent,
  TrackerIssue,
  PullRequest,
  MergeResult,
  CIStatusValue,
  StoredCredential,
  CredentialCreateRequest,
  SecretType,
  VolundrTemplate,
  VolundrPreset,
  VolundrIdentity,
  VolundrTenant,
  AdminSettings,
  PersonalAccessToken,
  CreatePATResult,
} from './domain/models';
