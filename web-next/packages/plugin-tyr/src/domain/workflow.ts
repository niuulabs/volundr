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

export const workflowNodeKindSchema = z.enum(['stage', 'gate', 'cond']);
export type WorkflowNodeKind = z.infer<typeof workflowNodeKindSchema>;

/** Spatial position for UI rendering (pixels from top-left). */
const positionSchema = z.object({ x: z.number(), y: z.number() });

export const workflowStageNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('stage'),
  label: z.string().min(1),
  /** Optional reference to the Raid this stage maps to. */
  raidId: z.string().nullable(),
  /** Persona IDs assigned to this stage (drives missing_persona validation). */
  personaIds: z.array(z.string()).default([]),
  position: positionSchema,
});
export type WorkflowStageNode = z.infer<typeof workflowStageNodeSchema>;

export const workflowGateNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('gate'),
  label: z.string().min(1),
  /** Human-readable approval condition description. */
  condition: z.string(),
  position: positionSchema,
});
export type WorkflowGateNode = z.infer<typeof workflowGateNodeSchema>;

export const workflowCondNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('cond'),
  label: z.string().min(1),
  /** Predicate expression evaluated at runtime. */
  predicate: z.string(),
  position: positionSchema,
});
export type WorkflowCondNode = z.infer<typeof workflowCondNodeSchema>;

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  workflowStageNodeSchema,
  workflowGateNodeSchema,
  workflowCondNodeSchema,
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

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
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

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
  /** Nodes in the DAG. IDs must be unique within a workflow. */
  nodes: z.array(workflowNodeSchema),
  /** Directed edges. Source and target must reference valid node IDs. */
  edges: z.array(workflowEdgeSchema),
});
export type Workflow = z.infer<typeof workflowSchema>;

/**
 * Validate DAG structural invariants beyond Zod schema:
 *  1. Node IDs are unique.
 *  2. Every edge source and target references an existing node.
 *  3. No self-loops.
 *  4. No duplicate edges (same source + target pair).
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
    const key = `${edge.source}->${edge.target}`;
    if (edgeKeys.has(key)) {
      throw new WorkflowValidationError(`Duplicate edge from ${edge.source} to ${edge.target}`);
    }
    edgeKeys.add(key);
  }
}
