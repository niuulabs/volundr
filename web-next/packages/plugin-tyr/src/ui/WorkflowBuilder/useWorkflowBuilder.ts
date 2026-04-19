/**
 * State hook for the WorkflowBuilder.
 *
 * Manages the editable Workflow, the active view tab, node selection, and
 * the pending "connect from" state used when drawing new edges.
 *
 * All mutations return a new Workflow so callers can persist as needed.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useState, useCallback } from 'react';
import type { Workflow, WorkflowNode, WorkflowNodeKind } from '../../domain/workflow';
import {
  makeNodeId,
  makeEdgeId,
  defaultBezierCPs,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  GATE_SIZE,
  COND_RADIUS,
} from './graphUtils';

export type WorkflowView = 'graph' | 'pipeline' | 'yaml';

export interface WorkflowBuilderState {
  workflow: Workflow;
  view: WorkflowView;
  selectedNodeId: string | null;
  /** When non-null, we're in "connect" mode — next node click completes the edge. */
  connectingFromId: string | null;
  /** When non-null, the NodeInspector Dialog is open for this node. */
  inspectorNodeId: string | null;
}

export interface WorkflowBuilderActions {
  setView(v: WorkflowView): void;
  selectNode(id: string | null): void;
  inspectNode(id: string | null): void;
  addNode(kind: WorkflowNodeKind, position?: { x: number; y: number }): void;
  deleteNode(id: string): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  startConnect(sourceId: string): void;
  cancelConnect(): void;
  completeConnect(targetId: string): void;
  addPersonaToStage(nodeId: string, personaId: string): void;
  removePersonaFromStage(nodeId: string, personaId: string): void;
  updateNodeLabel(id: string, label: string): void;
  setWorkflow(workflow: Workflow): void;
}

const DEFAULT_STAGE_POSITION = { x: 120, y: 120 };
const POSITION_OFFSET = 180;

function nextPosition(workflow: Workflow): { x: number; y: number } {
  if (workflow.nodes.length === 0) return { ...DEFAULT_STAGE_POSITION };
  const last = workflow.nodes[workflow.nodes.length - 1]!;
  return { x: last.position.x + POSITION_OFFSET, y: last.position.y };
}

function makeNewNode(kind: WorkflowNodeKind, position: { x: number; y: number }): WorkflowNode {
  const id = makeNodeId();
  switch (kind) {
    case 'stage':
      return { id, kind: 'stage', label: 'New stage', raidId: null, personaIds: [], position };
    case 'gate':
      return { id, kind: 'gate', label: 'Gate', condition: '', position };
    case 'cond':
      return { id, kind: 'cond', label: 'Condition', predicate: '', position };
  }
}

export function useWorkflowBuilder(
  initial: Workflow,
): WorkflowBuilderState & WorkflowBuilderActions {
  const [workflow, setWorkflowState] = useState<Workflow>(initial);
  const [view, setViewState] = useState<WorkflowView>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);

  const setView = useCallback((v: WorkflowView) => setViewState(v), []);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setConnectingFromId(null);
  }, []);

  const inspectNode = useCallback((id: string | null) => setInspectorNodeId(id), []);

  const setWorkflow = useCallback((w: Workflow) => setWorkflowState(w), []);

  const addNode = useCallback((kind: WorkflowNodeKind, position?: { x: number; y: number }) => {
    setWorkflowState((prev) => {
      const pos = position ?? nextPosition(prev);
      const node = makeNewNode(kind, pos);
      return { ...prev, nodes: [...prev.nodes, node] };
    });
  }, []);

  const deleteNode = useCallback((id: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelectedNodeId((s) => (s === id ? null : s));
    setConnectingFromId((s) => (s === id ? null : s));
    setInspectorNodeId((s) => (s === id ? null : s));
  }, []);

  const moveNode = useCallback((id: string, position: { x: number; y: number }) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
  }, []);

  const startConnect = useCallback((sourceId: string) => {
    setConnectingFromId(sourceId);
    setSelectedNodeId(sourceId);
  }, []);

  const cancelConnect = useCallback(() => setConnectingFromId(null), []);

  const completeConnect = useCallback((targetId: string) => {
    setConnectingFromId((fromId) => {
      if (!fromId || fromId === targetId) return null;
      setWorkflowState((prev) => {
        const alreadyExists = prev.edges.some((e) => e.source === fromId && e.target === targetId);
        if (alreadyExists) return prev;
        const srcNode = prev.nodes.find((n) => n.id === fromId);
        const tgtNode = prev.nodes.find((n) => n.id === targetId);
        if (!srcNode || !tgtNode) return prev;
        const { cp1, cp2 } = defaultBezierCPs(srcNode.position, tgtNode.position);
        const newEdge = { id: makeEdgeId(), source: fromId, target: targetId, cp1, cp2 };
        return { ...prev, edges: [...prev.edges, newEdge] };
      });
      return null;
    });
  }, []);

  const addPersonaToStage = useCallback((nodeId: string, personaId: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'stage') return n;
        if (n.personaIds.includes(personaId)) return n;
        return { ...n, personaIds: [...n.personaIds, personaId] };
      }),
    }));
  }, []);

  const removePersonaFromStage = useCallback((nodeId: string, personaId: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'stage') return n;
        return { ...n, personaIds: n.personaIds.filter((p) => p !== personaId) };
      }),
    }));
  }, []);

  const updateNodeLabel = useCallback((id: string, label: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
    }));
  }, []);

  // Suppress unused-variable warnings for constants used in nextPosition.
  void STAGE_WIDTH;
  void STAGE_HEIGHT;
  void GATE_SIZE;
  void COND_RADIUS;

  return {
    workflow,
    view,
    selectedNodeId,
    connectingFromId,
    inspectorNodeId,
    setView,
    selectNode,
    inspectNode,
    addNode,
    deleteNode,
    moveNode,
    startConnect,
    cancelConnect,
    completeConnect,
    addPersonaToStage,
    removePersonaFromStage,
    updateNodeLabel,
    setWorkflow,
  };
}
