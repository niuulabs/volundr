import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { TyrPage } from './ui/TyrPage';
import { WorkflowBuilderPage } from './ui/WorkflowBuilderPage';
import { SagasPage } from './ui/SagasPage';
import { DispatchView } from './ui/DispatchView';
import { SettingsPage, SettingsIndexPage } from './ui/settings/SettingsPage';
import { SettingsRail } from './ui/settings/SettingsRail';
import { SettingsTopbar } from './ui/settings/SettingsTopbar';
import { PlanWizard } from './ui/PlanWizard';

export const tyrPlugin = definePlugin({
  id: 'tyr',
  rune: 'ᛏ',
  title: 'Tyr',
  subtitle: 'sagas · raids · dispatch',
  tabs: [
    { id: 'dashboard', label: 'Dashboard', rune: '◈', path: '/tyr' },
    { id: 'sagas', label: 'Sagas', rune: 'ᛃ', path: '/tyr/sagas' },
    { id: 'dispatch', label: 'Dispatch', rune: '⇥', path: '/tyr/dispatch' },
    { id: 'plan', label: 'Plan', rune: '◇', path: '/tyr/plan' },
    { id: 'workflows', label: 'Workflows', rune: '⚙', path: '/tyr/workflows' },
    { id: 'settings', label: 'Settings', rune: '⚬', path: '/tyr/settings' },
  ],
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr',
      component: TyrPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/workflows',
      component: WorkflowBuilderPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/sagas',
      component: SagasPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/sagas/$sagaId',
      component: SagasPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/dispatch',
      component: DispatchView,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings',
      component: SettingsIndexPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings/personas',
      component: () => SettingsPage({ section: 'personas' }),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings/flock',
      component: () => SettingsPage({ section: 'flock' }),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings/dispatch',
      component: () => SettingsPage({ section: 'dispatch' }),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings/notifications',
      component: () => SettingsPage({ section: 'notifications' }),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/settings/audit',
      component: () => SettingsPage({ section: 'audit' }),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/tyr/plan',
      component: PlanWizard,
    }),
  ],
  subnav: () => SettingsRail(),
  topbarRight: () => SettingsTopbar(),
});

// Mock adapters
export {
  createMockTyrService,
  createMockDispatcherService,
  createMockTyrSessionService,
  createMockTrackerService,
  createMockTyrIntegrationService,
  createMockWorkflowService,
  createMockDispatchBus,
  createMockTyrSettingsService,
  createMockAuditLogService,
} from './adapters/mock';

// HTTP adapters
export {
  buildTyrHttpAdapter,
  buildDispatcherHttpAdapter,
  buildTyrSessionHttpAdapter,
  buildTrackerHttpAdapter,
  buildTyrIntegrationHttpAdapter,
  buildDispatchBusHttpAdapter,
  buildTyrSettingsHttpAdapter,
  buildTyrAuditLogHttpAdapter,
} from './adapters/http';

// Port interfaces + request/response types
export type {
  ITyrService,
  IDispatcherService,
  ITyrSessionService,
  ITrackerBrowserService,
  ITyrIntegrationService,
  IWorkflowService,
  IDispatchBus,
  DispatchResult,
  ITyrSettingsService,
  IAuditLogService,
  ITyrPersonaViewService,
  TyrPersonaSummary,
  TyrPersonaDetail,
  CommitSagaRequest,
  PlanSession,
  RaidSpec,
  PhaseSpec,
  ExtractedStructure,
  IntegrationConnection,
  CreateIntegrationParams,
  ConnectionTestResult,
  TelegramSetupResult,
  FlockConfig,
  DispatchDefaults,
  RetryPolicy,
  NotificationSettings,
  NotificationChannel,
  AuditEntry,
  AuditEntryKind,
  AuditFilter,
  // Re-exported domain types
  Saga,
  Phase,
  DispatcherState,
  DispatchRule,
  SessionInfo,
  TyrSessionStatus,
  TrackerProject,
  TrackerMilestone,
  TrackerIssue,
  RepoInfo,
} from './ports';

// Application layer — feasibility engine
export {
  checkFeasibility,
  checkRavenResolution,
  checkConfidence,
  checkUpstreamBlocked,
  checkClusterHealth,
  type FeasibilityGateName,
  type FeasibilityGate,
  type FeasibilityResult,
  type FeasibilityContext,
} from './application/dispatch-feasibility';

// Domain types (schemas + value objects)
export {
  sagaStatusSchema,
  phaseStatusSchema,
  raidStatusSchema,
  confidenceEventTypeSchema,
  sagaPhaseSummarySchema,
  sagaSchema,
  raidSchema,
  phaseSchema,
  confidenceEventSchema,
  type SagaStatus,
  type PhaseStatus,
  type RaidStatus,
  type ConfidenceEventType,
  type SagaPhaseSummary,
  type Raid,
  type ConfidenceEvent,
} from './domain/saga';

export {
  workflowNodeKindSchema,
  workflowStageNodeSchema,
  workflowGateNodeSchema,
  workflowCondNodeSchema,
  workflowNodeSchema,
  workflowEdgeSchema,
  workflowSchema,
  validateWorkflow,
  WorkflowValidationError,
  type WorkflowNodeKind,
  type WorkflowStageNode,
  type WorkflowGateNode,
  type WorkflowCondNode,
  type WorkflowNode,
  type WorkflowEdge,
  type Workflow,
} from './domain/workflow';

export { dispatcherStateSchema, dispatchRuleSchema } from './domain/dispatcher';

export { topologicalSort, detectCycle } from './domain/topologicalSort';
export type { TopologicalLayer } from './domain/topologicalSort';

export { validateWorkflowFull } from './domain/workflowValidation';
export type { WorkflowIssue, WorkflowIssueKind } from './domain/workflowValidation';

// WorkflowBuilder UI
export { WorkflowBuilder } from './ui/WorkflowBuilder';

export {
  PLAN_STEPS,
  PLAN_STEP_LABELS,
  planTransition,
  canTransition,
  stepIndex,
  PlanTransitionError,
  type PlanStep,
  type ClarifyingQuestion,
} from './domain/plan';

export { tyrSessionStatusSchema, sessionInfoSchema } from './domain/session';

export {
  trackerProjectSchema,
  trackerMilestoneSchema,
  trackerIssueSchema,
  repoInfoSchema,
  type RepoInfo as TrackerRepoInfo,
} from './domain/tracker';

export {
  flockConfigSchema,
  dispatchDefaultsSchema,
  retryPolicySchema,
  notificationSettingsSchema,
  notificationChannelSchema,
  auditEntrySchema,
  auditEntryKindSchema,
  auditFilterSchema,
} from './domain/settings';
