import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { TyrPage } from './ui/TyrPage';
import { WorkflowBuilderPage } from './ui/WorkflowBuilderPage';

export const tyrPlugin = definePlugin({
  id: 'tyr',
  rune: 'ᛏ',
  title: 'Tyr',
  subtitle: 'sagas · raids · dispatch',
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
  ],
});

// Mock adapters
export {
  createMockTyrService,
  createMockDispatcherService,
  createMockTyrSessionService,
  createMockTrackerService,
  createMockTyrIntegrationService,
  createMockWorkflowService,
} from './adapters/mock';

// HTTP adapters
export {
  buildTyrHttpAdapter,
  buildDispatcherHttpAdapter,
  buildTyrSessionHttpAdapter,
  buildTrackerHttpAdapter,
  buildTyrIntegrationHttpAdapter,
} from './adapters/http';

// Port interfaces + request/response types
export type {
  ITyrService,
  IDispatcherService,
  ITyrSessionService,
  ITrackerBrowserService,
  ITyrIntegrationService,
  IWorkflowService,
  CommitSagaRequest,
  PlanSession,
  RaidSpec,
  PhaseSpec,
  ExtractedStructure,
  IntegrationConnection,
  CreateIntegrationParams,
  ConnectionTestResult,
  TelegramSetupResult,
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

export { tyrSessionStatusSchema, sessionInfoSchema } from './domain/session';

export {
  trackerProjectSchema,
  trackerMilestoneSchema,
  trackerIssueSchema,
  repoInfoSchema,
  type RepoInfo as TrackerRepoInfo,
} from './domain/tracker';
