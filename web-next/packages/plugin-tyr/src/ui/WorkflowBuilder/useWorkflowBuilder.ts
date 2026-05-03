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

import { useState, useCallback, useRef } from 'react';
import type {
  Workflow,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowStageNode,
} from '../../domain/workflow';
import { makeNodeId, makeEdgeId, defaultBezierCPs } from './graphUtils';

export type WorkflowView = 'graph' | 'pipeline' | 'yaml';

export interface WorkflowBuilderState {
  workflow: Workflow;
  view: WorkflowView;
  selectedNodeId: string | null;
  /** When non-null, we're in "connect" mode — next node click completes the edge. */
  connectingFromId: string | null;
  connectingFromLabel: string | null;
  /** When non-null, the NodeInspector Dialog is open for this node. */
  inspectorNodeId: string | null;
}

export interface WorkflowBuilderActions {
  setView(v: WorkflowView): void;
  selectNode(id: string | null): void;
  inspectNode(id: string | null): void;
  addNode(kind: WorkflowNodeKind, position?: { x: number; y: number }): void;
  addStageWithPersona(personaId: string, position?: { x: number; y: number }): void;
  deleteNode(id: string): void;
  deleteEdge(id: string): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  startConnect(sourceId: string, label?: string): void;
  cancelConnect(): void;
  completeConnect(targetId: string, inputLabel?: string): void;
  addPersonaToStage(nodeId: string, personaId: string, budget?: number): void;
  replacePersonaInStage(nodeId: string, previousPersonaId: string, personaId: string): void;
  updatePersonaBudget(nodeId: string, personaId: string, budget: number): void;
  removePersonaFromStage(nodeId: string, personaId: string): void;
  updateNodeLabel(id: string, label: string): void;
  updateNode(id: string, patch: Partial<WorkflowNode>): void;
  updateWorkflowMeta(patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>>): void;
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
      return {
        id,
        kind: 'stage',
        label: 'New stage',
        raidId: null,
        personaIds: [],
        stageMembers: [],
        executionMode: 'parallel',
        maxConcurrent: 3,
        joinMode: 'all',
        position,
      };
    case 'gate':
      return {
        id,
        kind: 'gate',
        label: 'Gate',
        condition: '',
        approvers: ['jonas@niuulabs.io'],
        autoForwardAfter: '30m',
        position,
      };
    case 'cond':
      return { id, kind: 'cond', label: 'Condition', predicate: '', position };
    case 'trigger':
      return { id, kind: 'trigger', label: 'Manual trigger', source: 'manual dispatch', position };
    case 'end':
      return { id, kind: 'end', label: 'Complete', position };
  }
}

function syncStagePersonaIds(node: WorkflowStageNode): WorkflowStageNode {
  const hasExplicitStageMembers = Object.prototype.hasOwnProperty.call(node, 'stageMembers');
  const stageMembers = hasExplicitStageMembers
    ? (node.stageMembers ?? [])
    : (node.personaIds ?? []).map((personaId) => ({ personaId, budget: 40 }));
  const personaIds = stageMembers.map((member) => member.personaId);
  return {
    ...node,
    stageMembers,
    executionMode: node.executionMode ?? 'parallel',
    maxConcurrent: node.maxConcurrent ?? 3,
    joinMode: node.joinMode ?? 'all',
    personaIds,
  };
}

export function useWorkflowBuilder(
  initial: Workflow,
): WorkflowBuilderState & WorkflowBuilderActions {
  const [workflow, setWorkflowState] = useState<Workflow>(initial);
  const [view, setViewState] = useState<WorkflowView>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectingFromLabel, setConnectingFromLabel] = useState<string | null>(null);
  const connectingFromRef = useRef<string | null>(null);
  const connectingLabelRef = useRef<string | null>(null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);

  const setView = useCallback((v: WorkflowView) => setViewState(v), []);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    connectingFromRef.current = null;
    connectingLabelRef.current = null;
    setConnectingFromId(null);
    setConnectingFromLabel(null);
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

  const addStageWithPersona = useCallback(
    (personaId: string, position?: { x: number; y: number }) => {
      setWorkflowState((prev) => {
        const pos = position ?? nextPosition(prev);
        const node = makeNewNode('stage', pos);
        return {
          ...prev,
          nodes: [
            ...prev.nodes,
            node.kind === 'stage'
              ? syncStagePersonaIds({
                  ...node,
                  stageMembers: [{ personaId, budget: 40 }],
                })
              : node,
          ],
        };
      });
    },
    [],
  );

  const deleteNode = useCallback((id: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelectedNodeId((s) => (s === id ? null : s));
    if (connectingFromRef.current === id) {
      connectingFromRef.current = null;
      setConnectingFromId(null);
    }
    setInspectorNodeId((s) => (s === id ? null : s));
  }, []);

  const deleteEdge = useCallback((id: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      edges: prev.edges.filter((edge) => edge.id !== id),
    }));
  }, []);

  const moveNode = useCallback((id: string, position: { x: number; y: number }) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
  }, []);

  const startConnect = useCallback((sourceId: string, label?: string) => {
    if (!label) return;
    connectingFromRef.current = sourceId;
    connectingLabelRef.current = label;
    setConnectingFromId(sourceId);
    setConnectingFromLabel(label);
    setSelectedNodeId(sourceId);
  }, []);

  const cancelConnect = useCallback(() => {
    connectingFromRef.current = null;
    connectingLabelRef.current = null;
    setConnectingFromId(null);
    setConnectingFromLabel(null);
  }, []);

  const completeConnect = useCallback((targetId: string, inputLabel?: string) => {
    const fromId = connectingFromRef.current;
    const fromLabel = connectingLabelRef.current;
    connectingFromRef.current = null;
    connectingLabelRef.current = null;
    setConnectingFromId(null);
    setConnectingFromLabel(null);
    if (!fromId || !fromLabel || !inputLabel || fromId === targetId) return;
    setWorkflowState((prev) => {
      const edgeLabel = `${fromLabel} -> ${inputLabel}`;
      const alreadyExists = prev.edges.some(
        (e) =>
          e.source === fromId && e.target === targetId && (e.label ?? '') === (edgeLabel ?? ''),
      );
      if (alreadyExists) return prev;
      const srcNode = prev.nodes.find((n) => n.id === fromId);
      const tgtNode = prev.nodes.find((n) => n.id === targetId);
      if (!srcNode || !tgtNode) return prev;
      const { cp1, cp2 } = defaultBezierCPs(srcNode.position, tgtNode.position);
      const newEdge = {
        id: makeEdgeId(),
        source: fromId,
        target: targetId,
        label: edgeLabel,
        cp1,
        cp2,
      };
      return { ...prev, edges: [...prev.edges, newEdge] };
    });
  }, []);

  const addPersonaToStage = useCallback((nodeId: string, personaId: string, budget = 40) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'stage') return n;
        const normalized = syncStagePersonaIds(n);
        const stageMembers = normalized.stageMembers ?? [];
        if (stageMembers.some((member) => member.personaId === personaId)) return normalized;
        return syncStagePersonaIds({
          ...normalized,
          stageMembers: [...stageMembers, { personaId, budget }],
        });
      }),
    }));
  }, []);

  const replacePersonaInStage = useCallback(
    (nodeId: string, previousPersonaId: string, personaId: string) => {
      setWorkflowState((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== nodeId || n.kind !== 'stage') return n;
          const normalized = syncStagePersonaIds(n);
          const stageMembers = normalized.stageMembers ?? [];
          return syncStagePersonaIds({
            ...normalized,
            stageMembers: stageMembers.map((member) =>
              member.personaId === previousPersonaId ? { ...member, personaId } : member,
            ),
          });
        }),
      }));
    },
    [],
  );

  const updatePersonaBudget = useCallback((nodeId: string, personaId: string, budget: number) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'stage') return n;
        const normalized = syncStagePersonaIds(n);
        const stageMembers = normalized.stageMembers ?? [];
        return syncStagePersonaIds({
          ...normalized,
          stageMembers: stageMembers.map((member) =>
            member.personaId === personaId ? { ...member, budget } : member,
          ),
        });
      }),
    }));
  }, []);

  const removePersonaFromStage = useCallback((nodeId: string, personaId: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.kind !== 'stage') return n;
        const normalized = syncStagePersonaIds(n);
        const stageMembers = normalized.stageMembers ?? [];
        return syncStagePersonaIds({
          ...normalized,
          stageMembers: stageMembers.filter((member) => member.personaId !== personaId),
        });
      }),
    }));
  }, []);

  const updateNodeLabel = useCallback((id: string, label: string) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
    }));
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<WorkflowNode>) => {
    setWorkflowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, ...patch } as WorkflowNode;
        return next.kind === 'stage' ? syncStagePersonaIds(next) : next;
      }),
    }));
  }, []);

  const updateWorkflowMeta = useCallback(
    (patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>>) => {
      setWorkflowState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  return {
    workflow,
    view,
    selectedNodeId,
    connectingFromId,
    connectingFromLabel,
    inspectorNodeId,
    setView,
    selectNode,
    inspectNode,
    addNode,
    addStageWithPersona,
    deleteNode,
    deleteEdge,
    moveNode,
    startConnect,
    cancelConnect,
    completeConnect,
    addPersonaToStage,
    replacePersonaInStage,
    updatePersonaBudget,
    removePersonaFromStage,
    updateNodeLabel,
    updateNode,
    updateWorkflowMeta,
    setWorkflow,
  };
}
