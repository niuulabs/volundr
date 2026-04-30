import { z } from 'zod';

/**
 * Workflow — a DAG value object representing a structured execution plan.
 *
 * Nodes are one of three kinds:
 *   stage  — a unit of work (maps to a Raid)
 *   gate   — a checkpoint requiring human or automated approval before proceeding
 *   cond   — a conditional branch that routes execution based on a predicate
 *
 * Edges use cubic bezier curves for UI rendering (control-point pairs cp1/cp2).
 *
 * Owner: plugin-tyr.
 */

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const workflowNodeKindSchema = z.enum(['stage', 'gate', 'cond', 'trigger', 'end']);
export type WorkflowNodeKind = z.input<typeof workflowNodeKindSchema>;

/** Spatial position for UI rendering (pixels from top-left). */
const positionSchema = z.object({ x: z.number(), y: z.number() });
const stageExecutionModeSchema = z.enum(['parallel', 'sequential']);
const stageJoinModeSchema = z.enum(['all', 'any', 'merge']);
const stageMemberSchema = z.object({
  personaId: z.string().min(1),
  budget: z.number().int().nonnegative().default(40),
});
export type StageExecutionMode = z.input<typeof stageExecutionModeSchema>;
export type StageJoinMode = z.input<typeof stageJoinModeSchema>;
export type WorkflowStageMember = z.input<typeof stageMemberSchema>;

export const workflowStageNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('stage'),
  label: z.string().min(1),
  /** Optional reference to the Raid this stage maps to. */
  raidId: z.string().nullable(),
  /** Persona IDs assigned to this stage (drives missing_persona validation). */
  personaIds: z.array(z.string()).default([]),
  /** Rich stage membership used by the workflow editor. */
  stageMembers: z.array(stageMemberSchema).default([]),
  /** Parallel or sequential execution for the stage flock. */
  executionMode: stageExecutionModeSchema.default('parallel'),
  /** Maximum number of concurrent workers allowed in the stage. */
  maxConcurrent: z.number().int().positive().default(3),
  /** How inbound branches join when this stage has fan-in. */
  joinMode: stageJoinModeSchema.default('all'),
  position: positionSchema,
});
export type WorkflowStageNode = z.input<typeof workflowStageNodeSchema>;

export const workflowGateNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('gate'),
  label: z.string().min(1),
  /** Human-readable approval condition description. */
  condition: z.string(),
  approvers: z.array(z.string()).default([]),
  autoForwardAfter: z.string().default('30m'),
  position: positionSchema,
});
export type WorkflowGateNode = z.input<typeof workflowGateNodeSchema>;

export const workflowCondNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('cond'),
  label: z.string().min(1),
  /** Predicate expression evaluated at runtime. */
  predicate: z.string(),
  position: positionSchema,
});
export type WorkflowCondNode = z.input<typeof workflowCondNodeSchema>;

export const workflowTriggerNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('trigger'),
  label: z.string().min(1),
  source: z.string().default('manual dispatch'),
  dispatchEvent: z.string().default('code.requested'),
  position: positionSchema,
});
export type WorkflowTriggerNode = z.input<typeof workflowTriggerNodeSchema>;

export const workflowEndNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('end'),
  label: z.string().min(1),
  position: positionSchema,
});
export type WorkflowEndNode = z.input<typeof workflowEndNodeSchema>;

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  workflowStageNodeSchema,
  workflowGateNodeSchema,
  workflowCondNodeSchema,
  workflowTriggerNodeSchema,
  workflowEndNodeSchema,
]);
export type WorkflowNode = z.input<typeof workflowNodeSchema>;

// ---------------------------------------------------------------------------
// Edges (bezier curves)
// ---------------------------------------------------------------------------

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  /** Source node id. */
  source: z.string().min(1),
  /** Target node id. */
  target: z.string().min(1),
  /** Optional edge label (e.g. "yes" / "no" on cond nodes). */
  label: z.string().optional(),
  /** First bezier control point (relative to source). */
  cp1: positionSchema,
  /** Second bezier control point (relative to target). */
  cp2: positionSchema,
});
export type WorkflowEdge = z.input<typeof workflowEdgeSchema>;

// ---------------------------------------------------------------------------
// Workflow DAG invariants
// ---------------------------------------------------------------------------

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export const workflowSchema = z.object({
  /** Unique identifier (UUID). */
  id: z.string().uuid(),
  /** Display name. */
  name: z.string().min(1),
  /** Semantic version string (e.g. "1.4.2"). */
  version: z.string().optional(),
  /** Human-readable description. */
  description: z.string().optional(),
  /** Visibility scope in the persisted workflow catalog. */
  scope: z.enum(['system', 'user']).optional(),
  /** Owning user for user-scoped workflows. */
  ownerId: z.string().nullable().optional(),
  /** Compiled Tyr runtime YAML, when the workflow is executable. */
  definitionYaml: z.string().nullable().optional(),
  /** Backend compile diagnostics for non-executable graph shapes. */
  compileErrors: z.array(z.string()).optional(),
  /** Nodes in the DAG. IDs must be unique within a workflow. */
  nodes: z.array(workflowNodeSchema),
  /** Directed edges. Source and target must reference valid node IDs. */
  edges: z.array(workflowEdgeSchema),
});
export type Workflow = z.input<typeof workflowSchema>;

/**
 * Validate DAG structural invariants beyond Zod schema:
 *  1. Node IDs are unique.
 *  2. Every edge source and target references an existing node.
 *  3. No self-loops.
 *  4. No duplicate edges (same source + target + label tuple).
 *
 * Throws WorkflowValidationError on the first violated invariant.
 */
export function validateWorkflow(workflow: Workflow): void {
  const nodeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      throw new WorkflowValidationError(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  const edgeKeys = new Set<string>();

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new WorkflowValidationError(
        `Edge ${edge.id} references unknown source node: ${edge.source}`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      throw new WorkflowValidationError(
        `Edge ${edge.id} references unknown target node: ${edge.target}`,
      );
    }
    if (edge.source === edge.target) {
      throw new WorkflowValidationError(`Edge ${edge.id} is a self-loop on node: ${edge.source}`);
    }
    const key = `${edge.source}->${edge.target}->${edge.label ?? ''}`;
    if (edgeKeys.has(key)) {
      throw new WorkflowValidationError(
        `Duplicate edge from ${edge.source} to ${edge.target} (${edge.label ?? 'unlabelled'})`,
      );
    }
    edgeKeys.add(key);
  }
}
