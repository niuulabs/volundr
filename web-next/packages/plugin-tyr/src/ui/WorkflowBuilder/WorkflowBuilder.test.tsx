import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowBuilder } from './WorkflowBuilder';
import type { Workflow } from '../../domain/workflow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkflow(): Workflow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Workflow',
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
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowBuilder', () => {
  it('renders the workflow-builder container', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('workflow-builder')).toBeInTheDocument();
  });

  it('displays the workflow name in the header', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('builder-title')).toHaveTextContent('Test Workflow');
  });

  it('renders all three view tabs', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('tab-graph')).toBeInTheDocument();
    expect(screen.getByTestId('tab-pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('tab-yaml')).toBeInTheDocument();
  });

  it('defaults to graph view', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('tab-graph')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('graph-view')).toBeInTheDocument();
  });

  it('switches to pipeline view when tab clicked', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    fireEvent.click(screen.getByTestId('tab-pipeline'));
    expect(screen.getByTestId('pipeline-view')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-view')).toBeNull();
  });

  it('switches to yaml view when tab clicked', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    fireEvent.click(screen.getByTestId('tab-yaml'));
    expect(screen.getByTestId('yaml-view')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-view')).toBeNull();
  });

  it('switches back to graph from yaml', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    fireEvent.click(screen.getByTestId('tab-yaml'));
    fireEvent.click(screen.getByTestId('tab-graph'));
    expect(screen.getByTestId('graph-view')).toBeInTheDocument();
  });

  it('does not render save button when onSave is not provided', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.queryByTestId('save-workflow')).toBeNull();
  });

  it('renders save button when onSave is provided', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} onSave={vi.fn()} />);
    expect(screen.getByTestId('save-workflow')).toBeInTheDocument();
  });

  it('calls onSave with current workflow when save button clicked', () => {
    const onSave = vi.fn();
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('save-workflow'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as Workflow;
    expect(saved.id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('always renders the ValidationPanel', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('validation-panel')).toBeInTheDocument();
  });

  it('shows library panel in graph view', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    expect(screen.getByTestId('library-panel')).toBeInTheDocument();
  });

  it('hides library panel in pipeline view', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    fireEvent.click(screen.getByTestId('tab-pipeline'));
    expect(screen.queryByTestId('library-panel')).toBeNull();
  });

  it('adds a new stage node when add-stage clicked in graph view', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    const countBefore = screen.getAllByTestId(/^workflow-node-/).length;
    fireEvent.click(screen.getByTestId('add-stage'));
    expect(screen.getAllByTestId(/^workflow-node-/)).toHaveLength(countBefore + 1);
  });

  it('tab-pipeline is active after switching to pipeline', () => {
    render(<WorkflowBuilder initialWorkflow={makeWorkflow()} />);
    fireEvent.click(screen.getByTestId('tab-pipeline'));
    expect(screen.getByTestId('tab-pipeline')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('tab-graph')).not.toHaveAttribute('data-active');
  });
});
