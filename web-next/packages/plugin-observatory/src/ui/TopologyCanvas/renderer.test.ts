import { describe, it, expect, vi } from 'vitest';
import { drawStars, drawZones, drawEdges, drawNode, drawMimir, drawMinimap } from './renderer';
import type { Topology, TopologyNode } from '../../domain';
import type { NodePosition } from './layoutEngine';

// ── Canvas context factory ────────────────────────────────────────────────────

function makeCtx() {
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: vi.fn().mockReturnValue(gradient),
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '' as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineCap: 'butt' as CanvasLineCap,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

// ── Shared test data ──────────────────────────────────────────────────────────

const NODES: TopologyNode[] = [
  { id: 'mimir-0',        typeId: 'mimir',     label: 'mímir',    parentId: null,         status: 'healthy' },
  { id: 'realm-asgard',   typeId: 'realm',     label: 'asgard',   parentId: null,         status: 'healthy' },
  { id: 'cluster-vk',     typeId: 'cluster',   label: 'valaskjálf', parentId: 'realm-asgard', status: 'healthy' },
  { id: 'host-mjolnir',   typeId: 'host',      label: 'mjölnir',  parentId: 'realm-asgard', status: 'healthy' },
  { id: 'tyr-0',          typeId: 'tyr',       label: 'tyr-0',    parentId: 'cluster-vk', status: 'healthy' },
  { id: 'bifrost-0',      typeId: 'bifrost',   label: 'bifröst',  parentId: 'cluster-vk', status: 'healthy' },
  { id: 'volundr-0',      typeId: 'volundr',   label: 'völundr',  parentId: 'cluster-vk', status: 'healthy' },
  { id: 'ravn-huginn',    typeId: 'ravn_long', label: 'huginn',   parentId: null,         status: 'healthy' },
  { id: 'ravn-coord',     typeId: 'ravn_raid', label: 'coord',    parentId: null,         status: 'healthy' },
  { id: 'skuld-0',        typeId: 'skuld',     label: 'skuld',    parentId: null,         status: 'healthy' },
  { id: 'valk-0',         typeId: 'valkyrie',  label: 'brynhildr',parentId: null,         status: 'healthy' },
  { id: 'printer-0',      typeId: 'printer',   label: 'gungnir',  parentId: null,         status: 'healthy' },
  { id: 'vaettir-0',      typeId: 'vaettir',   label: 'chatterbox',parentId: null,        status: 'healthy' },
  { id: 'beacon-0',       typeId: 'beacon',    label: 'espresense',parentId: null,        status: 'healthy' },
  { id: 'svc-0',          typeId: 'service',   label: 'grafana',  parentId: null,         status: 'healthy' },
  { id: 'model-0',        typeId: 'model',     label: 'claude',   parentId: null,         status: 'healthy' },
  { id: 'raid-0',         typeId: 'raid',      label: 'raid-0',   parentId: null,         status: 'observing' },
  { id: 'mimir-sub-0',    typeId: 'mimir_sub', label: 'mímir/code',parentId: 'mimir-0',   status: 'healthy' },
];

const TOPOLOGY: Topology = {
  timestamp: '2026-04-19T00:00:00Z',
  nodes: NODES,
  edges: [
    { id: 'e-solid',       sourceId: 'tyr-0',     targetId: 'volundr-0',  kind: 'solid' },
    { id: 'e-dashed-anim', sourceId: 'tyr-0',     targetId: 'raid-0',     kind: 'dashed-anim' },
    { id: 'e-dashed-long', sourceId: 'ravn-huginn',targetId: 'mimir-0',   kind: 'dashed-long' },
    { id: 'e-soft',        sourceId: 'bifrost-0', targetId: 'mimir-0',    kind: 'soft' },
    { id: 'e-raid',        sourceId: 'raid-0',    targetId: 'ravn-coord', kind: 'raid' },
  ],
};

// Build a positions map with simple values so rendering doesn't crash.
const POSITIONS = new Map<string, NodePosition>(
  NODES.map((n, i) => [n.id, { x: i * 60, y: i * 40 }]),
);

// ── drawStars ─────────────────────────────────────────────────────────────────

describe('drawStars', () => {
  it('calls save and restore', () => {
    const ctx = makeCtx();
    drawStars(ctx, 800, 600, 0);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('draws fillRect calls for star pixels', () => {
    const ctx = makeCtx();
    drawStars(ctx, 800, 600, 0);
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('does not throw for zero-size canvas', () => {
    const ctx = makeCtx();
    expect(() => drawStars(ctx, 0, 0, 0)).not.toThrow();
  });
});

// ── drawZones ─────────────────────────────────────────────────────────────────

describe('drawZones', () => {
  it('does not throw with realm and cluster nodes', () => {
    const ctx = makeCtx();
    expect(() => drawZones(ctx, NODES, POSITIONS, 0)).not.toThrow();
  });

  it('calls arc for realm circles', () => {
    const ctx = makeCtx();
    drawZones(ctx, NODES, POSITIONS, 0);
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('draws realm labels with fillText', () => {
    const ctx = makeCtx();
    drawZones(ctx, NODES, POSITIONS, 0);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('handles empty node list without throwing', () => {
    const ctx = makeCtx();
    expect(() => drawZones(ctx, [], new Map(), 0)).not.toThrow();
  });

  it('skips nodes with no position entry', () => {
    const ctx = makeCtx();
    const orphan: TopologyNode = { id: 'orphan', typeId: 'realm', label: 'orphan', parentId: null, status: 'healthy' };
    // orphan has no entry in POSITIONS — should not throw
    expect(() => drawZones(ctx, [orphan], POSITIONS, 0)).not.toThrow();
  });
});

// ── drawEdges ─────────────────────────────────────────────────────────────────

describe('drawEdges', () => {
  it('does not throw with all 5 edge kinds', () => {
    const ctx = makeCtx();
    expect(() => drawEdges(ctx, TOPOLOGY, POSITIONS, 0)).not.toThrow();
  });

  it('calls beginPath for each drawable edge', () => {
    const ctx = makeCtx();
    drawEdges(ctx, TOPOLOGY, POSITIONS, 0);
    // At least one beginPath per edge
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('handles edges with missing source position gracefully', () => {
    const ctx = makeCtx();
    const topo: Topology = {
      ...TOPOLOGY,
      edges: [{ id: 'e-missing', sourceId: 'does-not-exist', targetId: 'tyr-0', kind: 'solid' }],
    };
    expect(() => drawEdges(ctx, topo, POSITIONS, 0)).not.toThrow();
  });

  it('handles edges with missing target position gracefully', () => {
    const ctx = makeCtx();
    const topo: Topology = {
      ...TOPOLOGY,
      edges: [{ id: 'e-missing', sourceId: 'tyr-0', targetId: 'does-not-exist', kind: 'solid' }],
    };
    expect(() => drawEdges(ctx, topo, POSITIONS, 0)).not.toThrow();
  });

  it('animates dashed-anim edges with lineDashOffset', () => {
    const ctx = makeCtx();
    const topo: Topology = {
      ...TOPOLOGY,
      edges: [{ id: 'e-da', sourceId: 'tyr-0', targetId: 'raid-0', kind: 'dashed-anim' }],
    };
    drawEdges(ctx, topo, POSITIONS, 1000);
    expect((ctx.setLineDash as ReturnType<typeof vi.fn>).mock.calls.some(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as number[]).length > 0
    )).toBe(true);
  });

  it('uses setLineDash([]) for solid edges (no dash)', () => {
    const ctx = makeCtx();
    const topo: Topology = {
      ...TOPOLOGY,
      edges: [{ id: 'e-s', sourceId: 'tyr-0', targetId: 'volundr-0', kind: 'solid' }],
    };
    drawEdges(ctx, topo, POSITIONS, 0);
    // Called at least with empty array to reset dashes
    expect((ctx.setLineDash as ReturnType<typeof vi.fn>).mock.calls.some(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as number[]).length === 0
    )).toBe(true);
  });
});

// ── drawNode ──────────────────────────────────────────────────────────────────

describe('drawNode', () => {
  const pos: NodePosition = { x: 100, y: 100 };

  // Each typeId should render without throwing
  const TYPES = [
    'tyr', 'bifrost', 'volundr', 'ravn_long', 'ravn_raid', 'skuld',
    'valkyrie', 'printer', 'vaettir', 'beacon', 'service', 'model',
    'raid', 'mimir_sub', 'unknown-type',
  ];

  for (const typeId of TYPES) {
    it(`renders typeId="${typeId}" without throwing`, () => {
      const ctx = makeCtx();
      const node: TopologyNode = { id: `n-${typeId}`, typeId, label: typeId, parentId: null, status: 'healthy' };
      expect(() => drawNode(ctx, node, pos, false)).not.toThrow();
    });

    it(`renders typeId="${typeId}" hovered without throwing`, () => {
      const ctx = makeCtx();
      const node: TopologyNode = { id: `n-${typeId}`, typeId, label: typeId, parentId: null, status: 'healthy' };
      expect(() => drawNode(ctx, node, pos, true)).not.toThrow();
    });
  }

  it('skips drawing for typeId="mimir" (handled by drawMimir)', () => {
    const ctx = makeCtx();
    const node: TopologyNode = { id: 'mimir-0', typeId: 'mimir', label: 'mímir', parentId: null, status: 'healthy' };
    drawNode(ctx, node, pos, false);
    // No drawing calls should have been made
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('draws host as a rounded rect (uses quadraticCurveTo)', () => {
    const ctx = makeCtx();
    const host: TopologyNode = { id: 'h', typeId: 'host', label: 'tanngrisnir', parentId: null, status: 'healthy' };
    drawNode(ctx, host, pos, false);
    expect((ctx.quadraticCurveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('draws hover ring for hovered non-mimir non-host node', () => {
    const ctx = makeCtx();
    const node: TopologyNode = { id: 'tyr-0', typeId: 'tyr', label: 'tyr', parentId: null, status: 'healthy' };
    drawNode(ctx, node, pos, true);
    // A hover ring arc should be drawn before the shape
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('draws identity rune as fillText for tyr', () => {
    const ctx = makeCtx();
    const node: TopologyNode = { id: 'tyr-0', typeId: 'tyr', label: 'tyr', parentId: null, status: 'healthy' };
    drawNode(ctx, node, pos, false);
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    expect(calls.some(([text]) => text === 'ᛃ')).toBe(true);
  });

  it('draws identity rune as fillText for bifrost', () => {
    const ctx = makeCtx();
    const node: TopologyNode = { id: 'bf-0', typeId: 'bifrost', label: 'bifröst', parentId: null, status: 'healthy' };
    drawNode(ctx, node, pos, false);
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    expect(calls.some(([text]) => text === 'ᚨ')).toBe(true);
  });
});

// ── drawMimir ─────────────────────────────────────────────────────────────────

describe('drawMimir', () => {
  it('does not throw at full scale', () => {
    const ctx = makeCtx();
    expect(() => drawMimir(ctx, { x: 0, y: 0 }, 0, 1, 'MÍMIR')).not.toThrow();
  });

  it('does not throw at small scale (sub-Mímir)', () => {
    const ctx = makeCtx();
    expect(() => drawMimir(ctx, { x: 100, y: 100 }, 0, 0.4, 'Mímir/Code')).not.toThrow();
  });

  it('draws orbiting rune glyphs', () => {
    const ctx = makeCtx();
    drawMimir(ctx, { x: 0, y: 0 }, 0, 1, 'MÍMIR');
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    expect(calls.length).toBeGreaterThan(0);
  });

  it('draws the label text', () => {
    const ctx = makeCtx();
    drawMimir(ctx, { x: 0, y: 0 }, 0, 1, 'MY-LABEL');
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    expect(calls.some(([text]) => text === 'MY-LABEL')).toBe(true);
  });

  it('draws the dark core circle', () => {
    const ctx = makeCtx();
    drawMimir(ctx, { x: 0, y: 0 }, 0, 1, 'MÍMIR');
    // At least one arc call for the core + border circles
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('creates radial gradients for the nebula effect', () => {
    const ctx = makeCtx();
    drawMimir(ctx, { x: 0, y: 0 }, 0, 1, 'MÍMIR');
    expect((ctx.createRadialGradient as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ── drawMinimap ───────────────────────────────────────────────────────────────

describe('drawMinimap', () => {
  it('does not throw with full topology and valid camera', () => {
    const ctx = makeCtx();
    expect(() =>
      drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600)
    ).not.toThrow();
  });

  it('clears and fills the background', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 220, 165);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 220, 165);
  });

  it('draws realm outline arcs', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600);
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('renders node dots with fillRect', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600);
    // fillRect calls > 1 (background + node dots)
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('draws viewport rect with strokeRect', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600);
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('skips viewport rect when camZoom is 0', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 0, 800, 600, 4200, 3600);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('renders entity count caption', () => {
    const ctx = makeCtx();
    drawMinimap(ctx, 220, 165, TOPOLOGY, POSITIONS, 0, 0, 1, 800, 600, 4200, 3600);
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    expect(calls.some(([text]) => /entities/.test(text))).toBe(true);
  });
});
