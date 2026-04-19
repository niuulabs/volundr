import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegistryEditor } from './RegistryEditor';
import type { TypeRegistry } from '../domain/registry';

const REGISTRY: TypeRegistry = {
  version: 5,
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
      canContain: ['cluster'],
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
      fields: [{ key: 'type', label: 'Type', type: 'string' }],
    },
  ],
};

describe('RegistryEditor', () => {
  it('renders the registry title', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    expect(screen.getByText('Entity type registry')).toBeInTheDocument();
  });

  it('shows registry version and type count', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    expect(screen.getByText('rev 5')).toBeInTheDocument();
    expect(screen.getByText('3 types')).toBeInTheDocument();
  });

  it('renders the three tab buttons', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    expect(screen.getByRole('tab', { name: 'Types' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Containment' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Json' })).toBeInTheDocument();
  });

  it('shows the Types tab by default', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    expect(screen.getByRole('tab', { name: 'Types' })).toHaveAttribute('aria-selected', 'true');
    // TypesTab renders a search input
    expect(screen.getByRole('searchbox', { name: 'Filter entity types' })).toBeInTheDocument();
  });

  it('switches to Containment tab on click', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Containment' }));
    expect(screen.getByRole('tab', { name: 'Containment' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tree', { name: 'Containment tree' })).toBeInTheDocument();
  });

  it('switches to JSON tab on click', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Json' }));
    expect(screen.getByRole('tab', { name: 'Json' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Registry JSON')).toBeInTheDocument();
  });

  it('shows preview drawer with first type selected by default', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    // TypePreviewDrawer shows the first type (realm) - 'realm' appears in multiple places
    expect(screen.getAllByText('realm').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Type · topology')).toBeInTheDocument();
  });

  it('updates preview when a type card is clicked', () => {
    render(<RegistryEditor registry={REGISTRY} />);
    fireEvent.click(screen.getByRole('button', { name: /Cluster \(cluster\)/ }));
    // 'A cluster.' appears in both the type card and preview drawer
    expect(screen.getAllByText('A cluster.').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onSave when containment drag-drop reparents a type', () => {
    const onSave = vi.fn();
    render(<RegistryEditor registry={REGISTRY} onSave={onSave} />);

    // Switch to containment tab
    fireEvent.click(screen.getByRole('tab', { name: 'Containment' }));

    const dt = {
      effectAllowed: 'uninitialized' as DataTransfer['effectAllowed'],
      dropEffect: 'none' as DataTransfer['dropEffect'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(''),
    };

    const serviceNode = screen.getByRole('treeitem', { name: 'Service' });
    const realmNode = screen.getByRole('treeitem', { name: 'Realm' });

    fireEvent.dragStart(serviceNode, { dataTransfer: dt });
    fireEvent.dragOver(realmNode, { dataTransfer: dt });
    fireEvent.drop(realmNode, { dataTransfer: dt });

    expect(onSave).toHaveBeenCalledOnce();
    const saved: TypeRegistry = onSave.mock.calls[0][0];
    const realm = saved.types.find((t) => t.id === 'realm');
    expect(realm?.canContain).toContain('service');
    expect(saved.version).toBe(REGISTRY.version + 1);
  });

  it('does NOT call onSave when cycle is detected', () => {
    const onSave = vi.fn();
    render(<RegistryEditor registry={REGISTRY} onSave={onSave} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Containment' }));

    const dt = {
      effectAllowed: 'uninitialized' as DataTransfer['effectAllowed'],
      dropEffect: 'none' as DataTransfer['dropEffect'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(''),
    };

    const realmNode = screen.getByRole('treeitem', { name: 'Realm' });
    const clusterNode = screen.getByRole('treeitem', { name: 'Cluster' });

    fireEvent.dragStart(realmNode, { dataTransfer: dt });
    fireEvent.dragOver(clusterNode, { dataTransfer: dt });
    fireEvent.drop(clusterNode, { dataTransfer: dt });

    expect(onSave).not.toHaveBeenCalled();
  });
});
