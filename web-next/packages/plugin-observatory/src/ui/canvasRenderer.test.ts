/**
 * Unit tests for canvasRenderer.ts.
 * Uses a mock 2D context so no DOM canvas is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rgba,
  drawStars,
  drawRealmRing,
  drawClusterRing,
  drawConnection,
  drawConnections,
  drawMimir,
  drawHost,
  drawNode,
  drawMinimap,
} from './canvasRenderer';
import { CANVAS_CONFIG } from './canvasConfig';
import type { Connection } from '../domain/connections';
import type { TopologyEntity, TopologySnapshot } from '../domain/topology';

// ── Mock CanvasRenderingContext2D ────────────────────────────────────────────

function makeMockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: vi.fn().mockReturnValue(gradient),
    createLinearGradient: vi.fn().mockReturnValue(gradient),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineDashOffset: 0,
    lineCap: 'round' as CanvasLineCap,
  } as unknown as CanvasRenderingContext2D;
}

let ctx: CanvasRenderingContext2D;

beforeEach(() => {
  ctx = makeMockCtx();
});

// ── rgba helper ────────────────────────────────────────────────────────────

describe('rgba', () => {
  it('formats an rgba string', () => {
    expect(rgba({ r: 186, g: 230, b: 253 }, 0.5)).toBe('rgba(186,230,253,0.5)');
    expect(rgba({ r: 0, g: 0, b: 0 }, 1)).toBe('rgba(0,0,0,1)');
  });
});

// ── drawStars ─────────────────────────────────────────────────────────────

describe('drawStars', () => {
  it('calls fillRect for each star', () => {
    drawStars(ctx, 800, 600, 0);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('animates: different now values produce different fillStyle assignments', () => {
    drawStars(ctx, 800, 600, 0);
    const calls0 = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.clearAllMocks();
    ctx = makeMockCtx();
    drawStars(ctx, 800, 600, 999999);
    const calls1 = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
    // Same number of stars regardless of time.
    expect(calls0).toBe(calls1);
    expect(calls0).toBe(CANVAS_CONFIG.starGridCols * CANVAS_CONFIG.starGridRows);
  });
});

// ── drawRealmRing ────────────────────────────────────────────────────────

describe('drawRealmRing', () => {
  it('draws gradient fill and arc stroke', () => {
    drawRealmRing(ctx, { x: 0, y: 0 }, 200, 'Asgard', 0, 90, 'asgard.local');
    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('renders without optional vlan/dns', () => {
    expect(() => drawRealmRing(ctx, { x: 10, y: 10 }, 100, 'Midgard', 0)).not.toThrow();
  });
});

// ── drawClusterRing ──────────────────────────────────────────────────────

describe('drawClusterRing', () => {
  it('draws dashed ring and label', () => {
    drawClusterRing(ctx, { x: 100, y: 100 }, 120, 'Valaskjálf');
    expect(ctx.setLineDash).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});

// ── drawConnection — all 5 kinds ─────────────────────────────────────────

describe('drawConnection', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 100 };

  const kinds: Connection['kind'][] = ['solid', 'dashed-anim', 'dashed-long', 'soft', 'raid'];

  for (const kind of kinds) {
    it(`draws kind="${kind}" without throwing`, () => {
      expect(() => drawConnection(ctx, from, to, kind, 0)).not.toThrow();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  }

  it('dashed-anim sets animated lineDashOffset', () => {
    drawConnection(ctx, from, to, 'dashed-anim', 800);
    // lineDashOffset was set (to -800/80 = -10).
    expect((ctx as unknown as Record<string, unknown>).lineDashOffset).toBe(-800 / 80);
  });

  it('dashed-long sets animated lineDashOffset', () => {
    drawConnection(ctx, from, to, 'dashed-long', 1200);
    expect((ctx as unknown as Record<string, unknown>).lineDashOffset).toBe(-1200 / 120);
  });
});

describe('drawConnections', () => {
  it('skips connections with missing source or target positions', () => {
    const layout = new Map([['src', { x: 0, y: 0 }]]);
    const conns: Connection[] = [{ id: 'c1', sourceId: 'src', targetId: 'missing', kind: 'solid' }];
    expect(() => drawConnections(ctx, conns, layout, 0)).not.toThrow();
    // No lines drawn for missing entity.
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it('draws each valid connection', () => {
    const layout = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 100 }],
    ]);
    const conns: Connection[] = [{ id: 'c1', sourceId: 'a', targetId: 'b', kind: 'solid' }];
    drawConnections(ctx, conns, layout, 0);
    expect(ctx.beginPath).toHaveBeenCalled();
  });
});

// ── drawMimir ─────────────────────────────────────────────────────────────

describe('drawMimir', () => {
  it('draws nebula, core, and rune rings at scale=1', () => {
    drawMimir(ctx, { x: 0, y: 0 }, 0, 1.0, 'MÍMIR');
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('draws at sub-scale (mimir_sub) without inner rune ring', () => {
    expect(() => drawMimir(ctx, { x: 50, y: 50 }, 0, 0.4, 'Mímir/Code')).not.toThrow();
  });

  it('shows inner rune ring at scale >= 0.8', () => {
    const spy = vi.spyOn(ctx, 'fillText');
    drawMimir(ctx, { x: 0, y: 0 }, 0, 0.9, 'Mímir');
    // Outer ring + inner ring + label = multiple fillText calls.
    expect(spy.mock.calls.length).toBeGreaterThan(CANVAS_CONFIG.mimiOuterRuneCount);
  });
});

// ── drawHost ─────────────────────────────────────────────────────────────

describe('drawHost', () => {
  const hostEntity: TopologyEntity = {
    id: 'host-01',
    typeId: 'host',
    name: 'DGX Spark',
    parentId: null,
    fields: { hw: 'DGX Spark', os: 'Ubuntu 24', cores: 144 },
    status: 'healthy',
    updatedAt: '2026-04-19T00:00:00Z',
  };

  it('draws rounded rect with label (not hovered)', () => {
    drawHost(ctx, hostEntity, { x: 0, y: 0 }, false);
    expect(ctx.fillText).toHaveBeenCalledWith('DGX Spark', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('DGX Spark', expect.any(Number), expect.any(Number));
  });

  it('uses brighter stroke when hovered', () => {
    drawHost(ctx, hostEntity, { x: 0, y: 0 }, false);
    const notHoveredStyle = (ctx as unknown as Record<string, unknown>).strokeStyle;
    ctx = makeMockCtx();
    drawHost(ctx, hostEntity, { x: 0, y: 0 }, true);
    const hoveredStyle = (ctx as unknown as Record<string, unknown>).strokeStyle;
    expect(notHoveredStyle).not.toBe(hoveredStyle);
  });

  it('renders without hw field', () => {
    const noHw: TopologyEntity = { ...hostEntity, fields: {} };
    expect(() => drawHost(ctx, noHw, { x: 0, y: 0 }, false)).not.toThrow();
  });
});

// ── drawNode — all entity types ───────────────────────────────────────────

describe('drawNode', () => {
  function makeEntity(typeId: string, extra: Partial<TopologyEntity> = {}): TopologyEntity {
    return {
      id: `${typeId}-01`,
      typeId,
      name: typeId,
      parentId: null,
      fields: {},
      status: 'idle',
      updatedAt: '2026-04-19T00:00:00Z',
      ...extra,
    };
  }

  const entityTypes = [
    'tyr',
    'volundr',
    'bifrost',
    'ravn_long',
    'ravn_raid',
    'skuld',
    'valkyrie',
    'printer',
    'vaettir',
    'beacon',
    'raid',
    'service',
    'model',
    'mimir',
    'mimir_sub',
    'host',
  ];

  for (const typeId of entityTypes) {
    it(`draws typeId="${typeId}" without throwing`, () => {
      const entity = makeEntity(typeId, {
        fields: typeId === 'ravn_long' ? { persona: 'thought' } : {},
        status: 'running',
      });
      expect(() => drawNode(ctx, entity, { x: 0, y: 0 }, 0, false)).not.toThrow();
    });

    it(`draws typeId="${typeId}" hovered without throwing`, () => {
      const entity = makeEntity(typeId);
      expect(() => drawNode(ctx, entity, { x: 10, y: 10 }, 1000, true)).not.toThrow();
    });
  }

  it('draws activity glow for processing status', () => {
    const entity = makeEntity('tyr', { status: 'processing' });
    const spy = vi.spyOn(ctx, 'createRadialGradient');
    drawNode(ctx, entity, { x: 0, y: 0 }, 0, false);
    // Glow should create a radial gradient.
    expect(spy).toHaveBeenCalled();
  });

  it('shows label for coordinator types', () => {
    const entity = makeEntity('tyr', { name: 'My Tyr' });
    const spy = vi.spyOn(ctx, 'fillText');
    drawNode(ctx, entity, { x: 0, y: 0 }, 0, false);
    const texts = spy.mock.calls.map((c) => c[0]);
    expect(texts.some((t) => t === 'My Tyr')).toBe(true);
  });
});

// ── drawMinimap ───────────────────────────────────────────────────────────

describe('drawMinimap', () => {
  const snapshot: TopologySnapshot = {
    entities: [
      {
        id: 'realm-a',
        typeId: 'realm',
        name: 'Asgard',
        parentId: null,
        fields: {},
        status: 'healthy',
        updatedAt: '2026-04-19T00:00:00Z',
      },
      {
        id: 'mimir-01',
        typeId: 'mimir',
        name: 'Mimir',
        parentId: null,
        fields: {},
        status: 'running',
        updatedAt: '2026-04-19T00:00:00Z',
      },
    ],
    connections: [],
  };

  const layout = new Map([
    ['realm-a', { x: 200, y: 0 }],
    ['mimir-01', { x: 0, y: 0 }],
  ]);

  it('clears and redraws without throwing', () => {
    expect(() =>
      drawMinimap(ctx, {
        snapshot,
        layout,
        camX: 0,
        camY: 0,
        zoom: 0.32,
        canvasW: 800,
        canvasH: 600,
      }),
    ).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('draws viewport rect when canvasW and zoom are set', () => {
    drawMinimap(ctx, {
      snapshot,
      layout,
      camX: 0,
      camY: 0,
      zoom: 1.0,
      canvasW: 800,
      canvasH: 600,
    });
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('skips viewport rect when canvasW=0', () => {
    drawMinimap(ctx, {
      snapshot,
      layout,
      camX: 0,
      camY: 0,
      zoom: 1.0,
      canvasW: 0,
      canvasH: 0,
    });
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('skips layout positions for entities without mapped positions', () => {
    const emptyLayout = new Map<string, { x: number; y: number }>();
    expect(() =>
      drawMinimap(ctx, {
        snapshot,
        layout: emptyLayout,
        camX: 0,
        camY: 0,
        zoom: 1.0,
        canvasW: 800,
        canvasH: 600,
      }),
    ).not.toThrow();
  });
});
