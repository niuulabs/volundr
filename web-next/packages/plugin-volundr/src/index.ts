import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { VolundrPage } from './ui/VolundrPage';
import { SessionsPage } from './ui/SessionsPage';
import { VolundrSessionRoute, VolundrArchivedRoute } from './ui/routes';

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
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/volundr/sessions',
      component: SessionsPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/volundr/session/$sessionId',
      component: VolundrSessionRoute,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/volundr/session/$sessionId/archived',
      component: VolundrArchivedRoute,
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
export { createMockFileSystemPort } from './adapters/mock';
export { buildVolundrHttpAdapter } from './adapters/http';

// Port types
export type { IVolundrService } from './ports/IVolundrService';
export type { IClusterAdapter } from './ports/IClusterAdapter';
export type { ISessionStore, SessionFilters } from './ports/ISessionStore';
export type { ITemplateStore } from './ports/ITemplateStore';
export type { IPtyStream } from './ports/IPtyStream';
export type { IMetricsStream, MetricPoint } from './ports/IMetricsStream';
export type { IFileSystemPort, FileTreeNode } from './ports/IFileSystemPort';

// UI components
export { Terminal } from './ui/Terminal/Terminal';
export type { TerminalProps } from './ui/Terminal/Terminal';
export { FileTree } from './ui/FileTree/FileTree';
export type { FileTreeProps } from './ui/FileTree/FileTree';
export { FileViewer } from './ui/FileTree/FileViewer';
export type { FileViewerProps } from './ui/FileTree/FileViewer';
export { SessionDetailPage } from './ui/SessionDetailPage';
export type { SessionDetailPageProps, SessionTab } from './ui/SessionDetailPage';
export { SessionsPage } from './ui/SessionsPage';

// Domain types
export type { Session, SessionState, SessionResources, SessionEvent } from './domain/session';
export { canTransition, transitionSession } from './domain/session';
export { toLifecycleState } from './ui/utils/toLifecycleState';
export type { ExecEntry, ExecStatus } from './domain/exec';
export { appendExecEntry, updateExecEntry } from './domain/exec';
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
