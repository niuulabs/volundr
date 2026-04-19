import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityDrawer } from './EntityDrawer';
import { createMockTopologyStream, createMockRegistryRepository } from '../../adapters/mock';
import type { TopologyNode, Topology, Registry } from '../../domain';

// ---------------------------------------------------------------------------
// Synchronous test fixtures pulled from mock adapters
// ---------------------------------------------------------------------------

let REGISTRY: Registry;
let TOPOLOGY: Topology;

beforeAll(async () => {
  REGISTRY = await createMockRegistryRepository().getRegistry();
  TOPOLOGY = createMockTopologyStream().getSnapshot()!;
});

const REALM_NODE: TopologyNode = {
  id: 'realm-asgard',
  typeId: 'realm',
  label: 'asgard',
  parentId: null,
  status: 'healthy',
};

const CLUSTER_NODE: TopologyNode = {
  id: 'cluster-valaskjalf',
  typeId: 'cluster',
  label: 'valaskjálf',
  parentId: 'realm-asgard',
  status: 'healthy',
};

const HOST_NODE: TopologyNode = {
  id: 'host-mjolnir',
  typeId: 'host',
  label: 'mjölnir',
  parentId: 'realm-asgard',
  status: 'healthy',
};

const TYR_NODE: TopologyNode = {
  id: 'tyr-0',
  typeId: 'tyr',
  label: 'tyr-0',
  parentId: 'cluster-valaskjalf',
  status: 'healthy',
};

const DEGRADED_NODE: TopologyNode = {
  id: 'svc-1',
  typeId: 'service',
  label: 'my-svc',
  parentId: 'cluster-valaskjalf',
  status: 'degraded',
};

function renderDrawer(
  node: TopologyNode | null,
  overrides?: { topology?: Topology | null; registry?: Registry | null; onNodeSelect?: (n: TopologyNode) => void },
) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <EntityDrawer
        node={node}
        topology={overrides?.topology !== undefined ? overrides.topology : TOPOLOGY}
        registry={overrides?.registry !== undefined ? overrides.registry : REGISTRY}
        onClose={onClose}
        onNodeSelect={overrides?.onNodeSelect}
      />,
    ),
  };
}

describe('EntityDrawer', () => {
  it('renders nothing visible when node is null (drawer closed)', () => {
    renderDrawer(null);
    // The Drawer portal should not render any content
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the node label as the drawer title', () => {
    renderDrawer(REALM_NODE);
    expect(screen.getByRole('dialog', { name: /asgard/i })).toBeInTheDocument();
  });

  it('displays entity type label and rune in the head for realm', () => {
    renderDrawer(REALM_NODE);
    expect(screen.getByText('Realm')).toBeInTheDocument();
    expect(screen.getByText('ᛞ')).toBeInTheDocument();
  });

  it('shows node status text in the head', () => {
    renderDrawer(REALM_NODE);
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('shows degraded status for a degraded node', () => {
    renderDrawer(DEGRADED_NODE);
    expect(screen.getByText('degraded')).toBeInTheDocument();
  });

  it('shows resident list for realm kind when residents exist', () => {
    renderDrawer(REALM_NODE);
    expect(screen.getByText('Residents')).toBeInTheDocument();
    // TOPOLOGY has cluster-valaskjalf and cluster-valhalla and host-mjolnir with parentId realm-asgard
    expect(screen.getByText('valaskjálf')).toBeInTheDocument();
    expect(screen.getByText('mjölnir')).toBeInTheDocument();
  });

  it('shows resident list for cluster kind', () => {
    renderDrawer(CLUSTER_NODE);
    expect(screen.getByText('Residents')).toBeInTheDocument();
    // tyr-0 and bifrost-0 and others have parentId cluster-valaskjalf
    expect(screen.getByText('tyr-0')).toBeInTheDocument();
  });

  it('shows resident list for host kind', () => {
    renderDrawer(HOST_NODE);
    expect(screen.getByText('Residents')).toBeInTheDocument();
    // huginn and muninn have parentId host-mjolnir
    expect(screen.getByText('huginn')).toBeInTheDocument();
  });

  it('does not show residents section when container has no residents', () => {
    const emptyTopology: Topology = { nodes: [REALM_NODE], edges: [], timestamp: '' };
    renderDrawer(REALM_NODE, { topology: emptyTopology });
    expect(screen.queryByText('Residents')).toBeNull();
  });

  it('calls onNodeSelect when a resident button is clicked', () => {
    const onNodeSelect = vi.fn();
    renderDrawer(REALM_NODE, { onNodeSelect });
    const clusterBtn = screen.getByTestId('resident-cluster-valaskjalf');
    fireEvent.click(clusterBtn);
    expect(onNodeSelect).toHaveBeenCalledOnce();
    expect(onNodeSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cluster-valaskjalf' }),
    );
  });

  it('shows Fields section for non-container entity (tyr)', () => {
    renderDrawer(TYR_NODE);
    expect(screen.getByText('Fields')).toBeInTheDocument();
    expect(screen.getByText('Active sagas')).toBeInTheDocument();
  });

  it('does not show Fields for non-container when entity has no fields', () => {
    const emptyFieldsRegistry: Registry = {
      ...REGISTRY,
      types: REGISTRY.types.map((t) =>
        t.id === 'tyr' ? { ...t, fields: [] } : t,
      ),
    };
    renderDrawer(TYR_NODE, { registry: emptyFieldsRegistry });
    expect(screen.queryByText('Fields')).toBeNull();
  });

  it('shows required field marker (*) for required fields', () => {
    renderDrawer(REALM_NODE);
    // realm is a container; switch to realm type entity for fields test
    // Instead test tyr which has required: undefined fields but realm has required: true
    // realm has { key: 'vlan', required: true }
    // But realm is a container, so Fields section won't show — need to pick a non-container
    // Ravn_long has required: undefined; use a custom registry
    const customRegistry: Registry = {
      ...REGISTRY,
      types: REGISTRY.types.map((t) =>
        t.id === 'tyr'
          ? { ...t, fields: [{ key: 'x', label: 'X Field', type: 'number', required: true }] }
          : t,
      ),
    };
    renderDrawer(TYR_NODE, { registry: customRegistry });
    expect(screen.getByLabelText('required')).toBeInTheDocument();
  });

  it('shows description when entity type has description', () => {
    renderDrawer(REALM_NODE);
    expect(screen.getByText(/VLAN-scoped network zone/)).toBeInTheDocument();
  });

  it('shows typeId as fallback label when entity type not in registry', () => {
    renderDrawer(
      { id: 'x', typeId: 'unknown-type', label: 'x', parentId: null, status: 'unknown' },
    );
    expect(screen.getByText('unknown-type')).toBeInTheDocument();
  });

  it('calls onClose when drawer close button is clicked', () => {
    const { onClose } = renderDrawer(REALM_NODE);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not throw when onNodeSelect is not provided and resident is clicked', () => {
    renderDrawer(REALM_NODE);
    const clusterBtn = screen.getByTestId('resident-cluster-valaskjalf');
    expect(() => fireEvent.click(clusterBtn)).not.toThrow();
  });

  it('handles null topology gracefully (no residents)', () => {
    renderDrawer(REALM_NODE, { topology: null });
    expect(screen.queryByText('Residents')).toBeNull();
  });

  it('handles null registry gracefully (no rune, fallback label)', () => {
    renderDrawer(REALM_NODE, { registry: null });
    // No rune rendered, typeId shown as label
    expect(screen.getByText('realm')).toBeInTheDocument();
  });

  it('shows all NodeStatus variants without error', () => {
    const statuses = ['healthy', 'degraded', 'failed', 'idle', 'observing', 'unknown'] as const;
    for (const status of statuses) {
      const { unmount } = render(
        <EntityDrawer
          node={{ id: 'x', typeId: 'service', label: 'x', parentId: null, status }}
          topology={TOPOLOGY}
          registry={REGISTRY}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });
});
