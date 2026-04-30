import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowBuilder } from './useWorkflowBuilder';
import type { Workflow } from '../../domain/workflow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkflow(): Workflow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test',
    nodes: [
      {
        id: 'stage-1',
        kind: 'stage',
        label: 'Stage 1',
        raidId: null,
        personaIds: [],
        position: { x: 100, y: 100 },
      },
      {
        id: 'gate-1',
        kind: 'gate',
        label: 'Gate',
        condition: 'ok',
        position: { x: 300, y: 100 },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'stage-1',
        target: 'gate-1',
        cp1: { x: 80, y: 0 },
        cp2: { x: -80, y: 0 },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — initial state', () => {
  it('starts with the provided workflow', () => {
    const wf = makeWorkflow();
    const { result } = renderHook(() => useWorkflowBuilder(wf));
    expect(result.current.workflow).toBe(wf);
  });

  it('starts on graph view', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    expect(result.current.view).toBe('graph');
  });

  it('has no selected node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    expect(result.current.selectedNodeId).toBeNull();
  });

  it('has no connectingFromId', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    expect(result.current.connectingFromId).toBeNull();
  });

  it('has no inspectorNodeId', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    expect(result.current.inspectorNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setView
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — setView', () => {
  it('changes view to pipeline', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.setView('pipeline'));
    expect(result.current.view).toBe('pipeline');
  });

  it('changes view to yaml', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.setView('yaml'));
    expect(result.current.view).toBe('yaml');
  });
});

// ---------------------------------------------------------------------------
// selectNode
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — selectNode', () => {
  it('sets selectedNodeId', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.selectNode('stage-1'));
    expect(result.current.selectedNodeId).toBe('stage-1');
  });

  it('clears connectingFromId when selecting a node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.startConnect('stage-1'));
    act(() => result.current.selectNode('gate-1'));
    expect(result.current.connectingFromId).toBeNull();
  });

  it('clears selection with null', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.selectNode('stage-1'));
    act(() => result.current.selectNode(null));
    expect(result.current.selectedNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — addNode', () => {
  it('adds a stage node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('stage'));
    expect(result.current.workflow.nodes).toHaveLength(3);
    expect(result.current.workflow.nodes[2]!.kind).toBe('stage');
  });

  it('adds a gate node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('gate'));
    expect(result.current.workflow.nodes[2]!.kind).toBe('gate');
  });

  it('adds a cond node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('cond'));
    expect(result.current.workflow.nodes[2]!.kind).toBe('cond');
  });

  it('adds node at specified position', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('stage', { x: 500, y: 200 }));
    const added = result.current.workflow.nodes[2]!;
    expect(added.position.x).toBe(500);
    expect(added.position.y).toBe(200);
  });

  it('new stage has empty personaIds', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('stage'));
    const added = result.current.workflow.nodes[2]!;
    if (added.kind === 'stage') {
      expect(added.personaIds).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// deleteNode
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — deleteNode', () => {
  it('removes the node from the workflow', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.deleteNode('stage-1'));
    expect(result.current.workflow.nodes.find((n) => n.id === 'stage-1')).toBeUndefined();
  });

  it('removes edges connected to the deleted node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.deleteNode('stage-1'));
    expect(
      result.current.workflow.edges.filter((e) => e.source === 'stage-1' || e.target === 'stage-1'),
    ).toHaveLength(0);
  });

  it('clears selectedNodeId when deleting the selected node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.selectNode('stage-1'));
    act(() => result.current.deleteNode('stage-1'));
    expect(result.current.selectedNodeId).toBeNull();
  });

  it('preserves other nodes', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.deleteNode('stage-1'));
    expect(result.current.workflow.nodes.find((n) => n.id === 'gate-1')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// moveNode
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — moveNode', () => {
  it('updates node position', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.moveNode('stage-1', { x: 999, y: 888 }));
    const node = result.current.workflow.nodes.find((n) => n.id === 'stage-1')!;
    expect(node.position.x).toBe(999);
    expect(node.position.y).toBe(888);
  });
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — startConnect / cancelConnect / completeConnect', () => {
  it('sets connectingFromId', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    expect(result.current.connectingFromId).toBe('stage-1');
  });

  it('cancelConnect clears connectingFromId', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.cancelConnect());
    expect(result.current.connectingFromId).toBeNull();
  });

  it('completeConnect adds a new edge', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    // add a third node so we can connect to it
    act(() => result.current.addNode('stage', { x: 500, y: 100 }));
    const newNodeId = result.current.workflow.nodes[2]!.id;
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect(newNodeId, 'review.verdict'));
    const newEdge = result.current.workflow.edges.find(
      (e) => e.source === 'stage-1' && e.target === newNodeId,
    );
    expect(newEdge).toBeDefined();
    expect(newEdge?.label).toBe('qa.report -> review.verdict');
    expect(result.current.connectingFromId).toBeNull();
  });

  it('completeConnect can target an end node without an explicit input label', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addNode('end', { x: 500, y: 100 }));
    const endNodeId = result.current.workflow.nodes[2]!.id;
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect(endNodeId));
    const newEdge = result.current.workflow.edges.find(
      (e) => e.source === 'stage-1' && e.target === endNodeId,
    );
    expect(newEdge).toBeDefined();
    expect(newEdge?.label).toBe('qa.report -> complete');
  });

  it('completeConnect can target a gate without an explicit input label', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect('gate-1'));
    const newEdge = result.current.workflow.edges.find(
      (e) => e.source === 'stage-1' && e.target === 'gate-1' && e.label === 'qa.report -> approval.requested',
    );
    expect(newEdge).toBeDefined();
  });

  it('completeConnect does not create duplicate edges', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect('gate-1', 'review.verdict'));
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect('gate-1', 'review.verdict'));
    const edges = result.current.workflow.edges.filter(
      (e) => e.source === 'stage-1' && e.target === 'gate-1',
    );
    expect(edges).toHaveLength(2);
    expect(edges.filter((e) => e.label === 'qa.report -> review.verdict')).toHaveLength(1);
  });

  it('completeConnect to self does nothing', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    const edgesBefore = result.current.workflow.edges.length;
    act(() => result.current.startConnect('stage-1', 'qa.report'));
    act(() => result.current.completeConnect('stage-1', 'review.verdict'));
    expect(result.current.workflow.edges).toHaveLength(edgesBefore);
  });
});

// ---------------------------------------------------------------------------
// persona management
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — persona management', () => {
  it('addPersonaToStage adds a persona ID to a stage', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addPersonaToStage('stage-1', 'persona-build'));
    const node = result.current.workflow.nodes.find((n) => n.id === 'stage-1')!;
    if (node.kind === 'stage') {
      expect(node.personaIds).toContain('persona-build');
    }
  });

  it('addPersonaToStage does not add duplicate persona', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addPersonaToStage('stage-1', 'persona-build'));
    act(() => result.current.addPersonaToStage('stage-1', 'persona-build'));
    const node = result.current.workflow.nodes.find((n) => n.id === 'stage-1')!;
    if (node.kind === 'stage') {
      expect(node.personaIds.filter((p) => p === 'persona-build')).toHaveLength(1);
    }
  });

  it('removePersonaFromStage removes a persona ID', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.addPersonaToStage('stage-1', 'persona-build'));
    act(() => result.current.removePersonaFromStage('stage-1', 'persona-build'));
    const node = result.current.workflow.nodes.find((n) => n.id === 'stage-1')!;
    if (node.kind === 'stage') {
      expect(node.personaIds).not.toContain('persona-build');
    }
  });

  it('addPersonaToStage is a no-op for non-stage nodes', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    const before = result.current.workflow.nodes.find((n) => n.id === 'gate-1');
    act(() => result.current.addPersonaToStage('gate-1', 'persona-build'));
    const after = result.current.workflow.nodes.find((n) => n.id === 'gate-1');
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// updateNodeLabel
// ---------------------------------------------------------------------------

describe('useWorkflowBuilder — updateNodeLabel', () => {
  it('updates label for a node', () => {
    const { result } = renderHook(() => useWorkflowBuilder(makeWorkflow()));
    act(() => result.current.updateNodeLabel('stage-1', 'Updated label'));
    const node = result.current.workflow.nodes.find((n) => n.id === 'stage-1')!;
    expect(node.label).toBe('Updated label');
  });
});
