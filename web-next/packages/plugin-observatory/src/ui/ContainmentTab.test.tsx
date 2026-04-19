import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContainmentTab } from './ContainmentTab';
import type { TypeRegistry } from '../domain/registry';

// realm → cluster → service (with host as a sibling of cluster under realm)
const REGISTRY: TypeRegistry = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  types: [
    {
      id: 'realm',
      label: 'Realm',
      rune: 'ᛞ',
      icon: 'globe',
      shape: 'ring',
      color: 'ice-100',
      size: 18,
      border: 'solid',
      canContain: ['cluster', 'host'],
      parentTypes: [],
      category: 'topology',
      description: 'A realm.',
      fields: [],
    },
    {
      id: 'cluster',
      label: 'Cluster',
      rune: 'ᚲ',
      icon: 'layers',
      shape: 'ring-dashed',
      color: 'ice-200',
      size: 14,
      border: 'dashed',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'topology',
      description: 'A cluster.',
      fields: [],
    },
    {
      id: 'host',
      label: 'Host',
      rune: 'ᚦ',
      icon: 'server',
      shape: 'rounded-rect',
      color: 'slate-400',
      size: 22,
      border: 'solid',
      canContain: [],
      parentTypes: ['realm'],
      category: 'hardware',
      description: 'A host.',
      fields: [],
    },
    {
      id: 'service',
      label: 'Service',
      rune: 'ᛦ',
      icon: 'box',
      shape: 'dot',
      color: 'ice-300',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster'],
      category: 'infrastructure',
      description: 'A service.',
      fields: [],
    },
  ],
};

/** Registry where one type's parentTypes reference is dangling (orphan) */
const ORPHAN_REGISTRY: TypeRegistry = {
  ...REGISTRY,
  types: [
    ...REGISTRY.types,
    {
      id: 'orphan',
      label: 'Orphan',
      rune: 'ᚢ',
      icon: 'help-circle',
      shape: 'dot',
      color: 'slate-400',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['missing-parent'],
      category: 'infrastructure',
      description: 'An orphaned type.',
      fields: [],
    },
  ],
};

function makeDt() {
  return {
    effectAllowed: 'uninitialized' as DataTransfer['effectAllowed'],
    dropEffect: 'none' as DataTransfer['dropEffect'],
    _data: {} as Record<string, string>,
    setData(t: string, v: string) {
      this._data[t] = v;
    },
    getData(t: string) {
      return this._data[t] ?? '';
    },
  };
}

describe('ContainmentTab', () => {
  it('renders root types', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    expect(screen.getByRole('treeitem', { name: 'Realm' })).toBeInTheDocument();
  });

  it('renders child types under their parents', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    expect(screen.getByRole('treeitem', { name: 'Cluster' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Service' })).toBeInTheDocument();
  });

  it('marks selected node with aria-selected', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId="cluster"
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    expect(screen.getByRole('treeitem', { name: 'Cluster' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'Realm' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onSelect when a node is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={onSelect}
        onReparent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('treeitem', { name: 'Cluster' }));
    expect(onSelect).toHaveBeenCalledWith('cluster');
  });

  it('calls onSelect on Enter keydown', () => {
    const onSelect = vi.fn();
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={onSelect}
        onReparent={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Cluster' }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('cluster');
  });

  it('shows orphans section when orphaned types exist', () => {
    render(
      <ContainmentTab
        registry={ORPHAN_REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    expect(screen.getByText(/orphans/i)).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Orphan' })).toBeInTheDocument();
  });

  it('does not show orphan section when no orphans', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    expect(screen.queryByText(/orphans/i)).not.toBeInTheDocument();
  });

  it('sets data-drag-state="dragging" on the dragged node', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    expect(serviceNode).toHaveAttribute('data-drag-state', 'dragging');
  });

  it('sets data-drag-state="drop-target" on valid hover target', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    const hostNode = screen.getByRole('treeitem', { name: 'Host' });

    // drag service, hover host (valid: service is not an ancestor of host)
    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    fireEvent.dragOver(hostNode, { dataTransfer: dt });
    expect(hostNode).toHaveAttribute('data-drag-state', 'drop-target');
  });

  it('sets data-drag-state="drop-invalid" when hovering would create cycle', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const realmNode = screen.getByRole('treeitem', { name: 'Realm' });
    const clusterNode = screen.getByRole('treeitem', { name: 'Cluster' });

    // drag realm onto cluster: realm → cluster already, so this would cycle
    fireEvent.dragStart(realmNode, { dataTransfer: dt });
    fireEvent.dragOver(clusterNode, { dataTransfer: dt });
    expect(clusterNode).toHaveAttribute('data-drag-state', 'drop-invalid');
  });

  it('sets data-drag-state="drop-ok" on valid but not-hovered targets', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    const hostNode = screen.getByRole('treeitem', { name: 'Host' });
    const realmNode = screen.getByRole('treeitem', { name: 'Realm' });

    // drag service; hover host; realm should be drop-ok (valid but not hovered)
    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    fireEvent.dragOver(hostNode, { dataTransfer: dt });
    expect(realmNode).toHaveAttribute('data-drag-state', 'drop-ok');
  });

  it('calls onReparent on valid drop', () => {
    const onReparent = vi.fn();
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={onReparent}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    const hostNode = screen.getByRole('treeitem', { name: 'Host' });

    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    fireEvent.dragOver(hostNode, { dataTransfer: dt });
    fireEvent.drop(hostNode, { dataTransfer: dt });
    expect(onReparent).toHaveBeenCalledWith('service', 'host');
  });

  it('does NOT call onReparent when drop would create a cycle', () => {
    const onReparent = vi.fn();
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={onReparent}
      />,
    );
    const dt = makeDt();
    const realmNode = screen.getByRole('treeitem', { name: 'Realm' });
    const clusterNode = screen.getByRole('treeitem', { name: 'Cluster' });

    fireEvent.dragStart(realmNode, { dataTransfer: dt });
    fireEvent.dragOver(clusterNode, { dataTransfer: dt });
    fireEvent.drop(clusterNode, { dataTransfer: dt });
    expect(onReparent).not.toHaveBeenCalled();
  });

  it('clears drag state on dragEnd', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    expect(serviceNode).toHaveAttribute('data-drag-state', 'dragging');
    fireEvent.dragEnd(serviceNode, { dataTransfer: dt });
    expect(serviceNode).not.toHaveAttribute('data-drag-state');
  });

  it('clears hover state on dragLeave', () => {
    render(
      <ContainmentTab
        registry={REGISTRY}
        selectedId={undefined}
        onSelect={vi.fn()}
        onReparent={vi.fn()}
      />,
    );
    const dt = makeDt();
    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    const hostNode = screen.getByRole('treeitem', { name: 'Host' });

    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    fireEvent.dragOver(hostNode, { dataTransfer: dt });
    expect(hostNode).toHaveAttribute('data-drag-state', 'drop-target');
    fireEvent.dragLeave(hostNode, { dataTransfer: dt });
    // After leave, host should lose the drop-target state (becomes drop-ok or undefined)
    expect(hostNode).not.toHaveAttribute('data-drag-state', 'drop-target');
  });
});
