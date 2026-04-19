/**
 * Pure canvas drawing helpers for the TopologyCanvas renderer.
 *
 * Every function takes an explicit CanvasRenderingContext2D — no global state,
 * no React imports. This makes them straightforward to unit-test with a mock ctx.
 */
import { CANVAS_CONFIG, MIMIR_RUNES } from './canvasConfig';
import type { Point, LayoutMap } from './layout';
import type { TopologyEntity, TopologySnapshot } from '../domain/topology';
import { CONNECTION_VISUAL } from '../domain/connections';
import type { Connection, ConnectionKind } from '../domain/connections';

// ── Colour helpers ────────────────────────────────────────────────────────

interface RGB {
  r: number;
  g: number;
  b: number;
}

const C = {
  ice: { r: 186, g: 230, b: 253 },
  frost: { r: 125, g: 211, b: 252 },
  moon: { r: 224, g: 242, b: 254 },
  indigo: { r: 147, g: 197, b: 253 },
  slate: { r: 148, g: 163, b: 184 },
  dim: { r: 100, g: 115, b: 140 },
  model: { r: 140, g: 170, b: 210 },
  valk: { r: 170, g: 205, b: 245 },
  device: { r: 130, g: 155, b: 185 },
  crit: { r: 239, g: 68, b: 68 },
} as const satisfies Record<string, RGB>;

export function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function typeColor(typeId: string): RGB {
  switch (typeId) {
    case 'tyr':
      return C.frost;
    case 'bifrost':
      return C.indigo;
    case 'volundr':
      return C.moon;
    case 'valkyrie':
      return C.valk;
    case 'model':
      return C.model;
    case 'ravn_long':
      return C.moon;
    case 'ravn_raid':
      return C.ice;
    case 'skuld':
      return C.indigo;
    case 'printer':
      return C.device;
    case 'vaettir':
      return C.device;
    case 'beacon':
      return C.dim;
    case 'service':
      return C.ice;
    case 'mimir':
      return C.moon;
    case 'mimir_sub':
      return C.moon;
    default:
      return C.slate;
  }
}

export function nodeSize(typeId: string): number {
  return (
    (CANVAS_CONFIG.nodeSizes as Record<string, number>)[typeId] ?? CANVAS_CONFIG.nodeSizes.default
  );
}

// ── Star field ────────────────────────────────────────────────────────────

export function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  ctx.save();
  const cols = CANVAS_CONFIG.starGridCols;
  const rows = CANVAS_CONFIG.starGridRows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const seed = (i * 91 + j * 53) % 997;
      const tw = 0.45 + 0.55 * Math.sin(now / 1400 + seed);
      const x = (seed * 13) % w;
      const y = (seed * 31) % h;
      ctx.fillStyle = rgba(C.ice, 0.1 + 0.22 * tw);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}

// ── Zone rings (realms + clusters) ────────────────────────────────────────

export function drawRealmRing(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  radius: number,
  label: string,
  now: number,
  vlan?: number,
  dns?: string,
): void {
  const { x, y } = pos;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, 'rgba(30,48,78,0.36)');
  grad.addColorStop(0.65, 'rgba(20,32,56,0.14)');
  grad.addColorStop(1, 'rgba(14,20,36,0.01)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  const pulse = 0.28 + 0.06 * Math.sin(now / 5000 + (vlan ?? 0) * 0.1);
  ctx.strokeStyle = rgba(C.indigo, pulse);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = rgba(C.ice, 0.78);
  ctx.font = '600 12px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label.toUpperCase(), x, y - radius - 28);

  if (dns != null || vlan != null) {
    ctx.fillStyle = rgba(C.slate, 0.52);
    ctx.font = '9px JetBrainsMono NF, monospace';
    const meta = [dns, vlan != null ? `VLAN ${vlan}` : null].filter(Boolean).join('  ·  ');
    ctx.fillText(meta, x, y - radius - 14);
  }
}

export function drawClusterRing(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  radius: number,
  label: string,
): void {
  const { x, y } = pos;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, 'rgba(40,58,88,0.20)');
  grad.addColorStop(1, 'rgba(20,28,48,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgba(C.indigo, 0.26);
  ctx.lineWidth = 0.9;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = rgba(C.ice, 0.56);
  ctx.font = '9px JetBrainsMono NF, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`⎔ ${label}`, x, y - radius - 5);
}

// ── Connection lines — all 5 kinds ────────────────────────────────────────

export function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  kind: ConnectionKind,
  now: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';

  // Use line width from the canonical CONNECTION_VISUAL definition to avoid drift.
  ctx.lineWidth = CONNECTION_VISUAL[kind].width;

  switch (kind) {
    case 'solid':
      // Control: Týr → Völundr. Solid indigo, no dash.
      ctx.strokeStyle = rgba(C.indigo, 0.32);
      ctx.setLineDash([]);
      break;

    case 'dashed-anim':
      // Active dispatch: Týr ⇝ raid coord. Animated dashes.
      ctx.strokeStyle = rgba(C.frost, 0.42);
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -now / 80;
      break;

    case 'dashed-long':
      // External model: Bifröst → provider. Longer dashes.
      ctx.strokeStyle = rgba(C.indigo, 0.24);
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -now / 120;
      break;

    case 'soft':
      // Read channel: ravn → Mímir. Thin, soft.
      ctx.strokeStyle = rgba(C.moon, 0.22);
      ctx.setLineDash([]);
      break;

    case 'raid':
      // Raid cohesion between members.
      ctx.strokeStyle = rgba(C.frost, 0.38);
      ctx.setLineDash([]);
      break;
  }

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** Draw all connections from the snapshot. */
export function drawConnections(
  ctx: CanvasRenderingContext2D,
  connections: Connection[],
  layout: LayoutMap,
  now: number,
): void {
  for (const conn of connections) {
    const from = layout.get(conn.sourceId);
    const to = layout.get(conn.targetId);
    if (!from || !to) continue;
    drawConnection(ctx, from, to, conn.kind, now);
  }
}

// ── Mímir (the knowledge well) ────────────────────────────────────────────

export function drawMimir(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  now: number,
  scale = 1.0,
  label = 'MÍMIR',
): void {
  const { x, y } = pos;
  const R = CANVAS_CONFIG.nodeSizes.mimir * scale;

  // Nebula halo
  const neb = ctx.createRadialGradient(x, y, 0, x, y, R * 2.6);
  neb.addColorStop(0, rgba({ r: 210, g: 230, b: 255 }, 0.58 * Math.min(1, scale + 0.2)));
  neb.addColorStop(0.35, rgba({ r: 180, g: 210, b: 245 }, 0.2 * Math.min(1, scale + 0.2)));
  neb.addColorStop(1, 'rgba(180,210,245,0)');
  ctx.fillStyle = neb;
  ctx.beginPath();
  ctx.arc(x, y, R * 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Inner glow ring
  const inner = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 1.1);
  inner.addColorStop(0, 'rgba(230,240,255,0)');
  inner.addColorStop(1, rgba({ r: 200, g: 225, b: 255 }, 0.36 * Math.min(1, scale + 0.2)));
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(x, y, R * 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Dark core
  ctx.fillStyle = 'rgba(9,9,11,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();

  // Core border
  ctx.strokeStyle = rgba({ r: 200, g: 225, b: 255 }, 0.58 * Math.min(1, scale + 0.2));
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();

  // Outer rune ring
  const outerCount = CANVAS_CONFIG.mimiOuterRuneCount;
  ctx.font = `${Math.round(12 * scale)}px JetBrainsMono NF, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < outerCount; i++) {
    const a = (i / outerCount) * Math.PI * 2 + now / 6000;
    ctx.fillStyle = rgba({ r: 210, g: 230, b: 255 }, 0.6 + 0.24 * Math.sin(now / 700 + i));
    ctx.fillText(
      MIMIR_RUNES[i % MIMIR_RUNES.length] ?? 'ᚠ',
      x + Math.cos(a) * (R + 10 * scale),
      y + Math.sin(a) * (R + 10 * scale),
    );
  }

  // Inner rune ring (only at sufficient scale)
  if (scale >= 0.8) {
    const innerCount = CANVAS_CONFIG.mimiInnerRuneCount;
    ctx.font = '10px JetBrainsMono NF, monospace';
    for (let i = 0; i < innerCount; i++) {
      const a = -(i / innerCount) * Math.PI * 2 + now / 4200;
      ctx.fillStyle = rgba({ r: 170, g: 200, b: 240 }, 0.3 + 0.18 * Math.cos(now / 500 + i));
      ctx.fillText(
        MIMIR_RUNES[(i + 7) % MIMIR_RUNES.length] ?? 'ᚠ',
        x + Math.cos(a) * (R + 26),
        y + Math.sin(a) * (R + 26),
      );
    }
  }

  // Label
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgba({ r: 210, g: 230, b: 255 }, scale >= 0.85 ? 0.9 : 0.7);
  ctx.font = `600 ${Math.round(10 * Math.max(0.85, scale))}px Inter, sans-serif`;
  ctx.fillText(label, x, y + R + (scale >= 0.85 ? 40 : 20));
  ctx.textBaseline = 'alphabetic';
}

// ── Host (rounded-rect container) ────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawHost(
  ctx: CanvasRenderingContext2D,
  entity: TopologyEntity,
  pos: Point,
  hovered: boolean,
): void {
  const size = CANVAS_CONFIG.nodeSizes.host;
  const w = size * 2.4;
  const h = size * 1.6;
  const x = pos.x - w / 2;
  const y = pos.y - h / 2;

  ctx.save();
  ctx.fillStyle = hovered ? 'rgba(45,55,78,0.58)' : 'rgba(27,35,54,0.40)';
  roundedRect(ctx, x, y, w, h, 9);
  ctx.fill();

  ctx.strokeStyle = hovered ? rgba(C.ice, 0.55) : rgba(C.slate, 0.32);
  ctx.lineWidth = hovered ? 1.4 : 0.9;
  roundedRect(ctx, x, y, w, h, 9);
  ctx.stroke();

  ctx.fillStyle = rgba(C.moon, 0.78);
  ctx.font = '600 9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(entity.name, x + 7, y + 13);

  const hw = typeof entity.fields['hw'] === 'string' ? entity.fields['hw'] : '';
  if (hw) {
    ctx.fillStyle = rgba(C.slate, 0.52);
    ctx.font = '8px JetBrainsMono NF, monospace';
    ctx.fillText(hw, x + 7, y + 24);
  }
  ctx.restore();
}

// ── Generic nodes ─────────────────────────────────────────────────────────

const IDENTITY_RUNES: Record<string, string> = {
  tyr: 'ᛃ',
  bifrost: 'ᚨ',
  volundr: 'ᚲ',
  mimir: 'ᛗ',
};

export function drawNode(
  ctx: CanvasRenderingContext2D,
  entity: TopologyEntity,
  pos: Point,
  now: number,
  hovered: boolean,
): void {
  if (entity.typeId === 'host') return drawHost(ctx, entity, pos, hovered);
  if (entity.typeId === 'mimir') return drawMimir(ctx, pos, now, 1.0, 'MÍMIR');
  if (entity.typeId === 'mimir_sub') return drawMimir(ctx, pos, now, 0.4, entity.name);

  const size = nodeSize(entity.typeId);
  const col = typeColor(entity.typeId);

  // Activity glow
  const status = entity.status;
  const glowActive = status === 'processing' || status === 'running' || status === 'observing';
  if (glowActive) {
    const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, size * 3);
    g.addColorStop(0, rgba(col, 0.28));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hover ring
  if (hovered) {
    ctx.strokeStyle = rgba(C.moon, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  drawShape(ctx, entity, pos, size, col);
  ctx.restore();

  // Labels for named coordinator types and hovered nodes
  const showLabel =
    ['tyr', 'bifrost', 'volundr', 'valkyrie', 'ravn_long'].includes(entity.typeId) || hovered;
  if (showLabel) {
    ctx.fillStyle = rgba(C.moon, hovered ? 0.95 : 0.75);
    ctx.font = `${hovered ? 600 : 500} 9px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(entity.name, pos.x, pos.y + size + 12);
  }

  // Identity rune inside coordinator nodes
  const identRune = IDENTITY_RUNES[entity.typeId];
  if (identRune) {
    ctx.fillStyle = 'rgba(9,9,11,0.88)';
    ctx.font = '600 11px JetBrainsMono NF, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(identRune, pos.x, pos.y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Rune inside long-ravn diamond
  if (entity.typeId === 'ravn_long' && typeof entity.fields['persona'] === 'string') {
    ctx.fillStyle = 'rgba(9,9,11,0.94)';
    ctx.font = '700 8px JetBrainsMono NF, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(entity.fields['persona'].slice(0, 1).toUpperCase(), pos.x, pos.y + 1);
    ctx.textBaseline = 'alphabetic';
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  entity: TopologyEntity,
  pos: Point,
  size: number,
  col: RGB,
): void {
  const { x, y } = pos;

  switch (entity.typeId) {
    case 'tyr':
    case 'volundr':
      // Square
      ctx.fillStyle = rgba(col, 0.92);
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      break;

    case 'bifrost':
      // Pentagon
      ctx.fillStyle = rgba(col, 0.92);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
        const px = x + Math.cos(a) * size;
        const py = y + Math.sin(a) * size;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;

    case 'ravn_long':
      // Diamond
      ctx.fillStyle = rgba(col, 0.94);
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fill();
      break;

    case 'ravn_raid':
      // Triangle (pointing up)
      ctx.fillStyle = rgba(col, 0.9);
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size * 0.7);
      ctx.lineTo(x - size, y + size * 0.7);
      ctx.closePath();
      ctx.fill();
      break;

    case 'skuld':
      // Hexagon (outlined)
      ctx.fillStyle = 'rgba(9,9,11,0.78)';
      ctx.strokeStyle = rgba(col, 0.9);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k / 6) * Math.PI * 2;
        const px = x + Math.cos(a) * size;
        const py = y + Math.sin(a) * size;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;

    case 'valkyrie':
      // Chevron (upward)
      ctx.fillStyle = rgba(col, 0.94);
      ctx.beginPath();
      ctx.moveTo(x - size, y + size * 0.6);
      ctx.lineTo(x, y - size);
      ctx.lineTo(x + size, y + size * 0.6);
      ctx.lineTo(x, y + size * 0.25);
      ctx.closePath();
      ctx.fill();
      break;

    case 'printer':
    case 'vaettir':
      // Outlined small square
      ctx.strokeStyle = rgba(col, 0.88);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - size, y - size, size * 2, size * 2);
      ctx.fillStyle = rgba(col, 0.22);
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      break;

    case 'beacon':
      // Dashed circle + dot
      ctx.strokeStyle = rgba(col, 0.58);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(col, 0.6);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'raid':
      // Dashed halo
      ctx.strokeStyle = rgba(C.frost, 0.3);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      break;

    case 'service':
    case 'model':
    default:
      // Dot
      ctx.fillStyle = rgba(col, 0.85);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      if (entity.typeId === 'model') {
        ctx.strokeStyle = rgba(C.indigo, 0.42);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      break;
  }
}

// ── Minimap ───────────────────────────────────────────────────────────────

export interface MinimapOpts {
  snapshot: TopologySnapshot;
  layout: LayoutMap;
  camX: number;
  camY: number;
  zoom: number;
  canvasW: number;
  canvasH: number;
}

export function drawMinimap(ctx: CanvasRenderingContext2D, opts: MinimapOpts): void {
  const MW = CANVAS_CONFIG.minimapWidth;
  const MH = CANVAS_CONFIG.minimapHeight;
  const WW = CANVAS_CONFIG.worldWidth;
  const WH = CANVAS_CONFIG.worldHeight;

  // World origin is at (0,0); canvas-world coords range ~[-WW/2, WW/2].
  const sx = MW / WW;
  const sy = MH / WH;

  ctx.clearRect(0, 0, MW, MH);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, MW, MH);

  // Realm rings
  for (const entity of opts.snapshot.entities) {
    if (entity.typeId !== 'realm') continue;
    const pos = opts.layout.get(entity.id);
    if (!pos) continue;
    const mx = (pos.x + WW / 2) * sx;
    const my = (pos.y + WH / 2) * sy;
    ctx.strokeStyle = 'rgba(147,197,253,0.24)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(mx, my, CANVAS_CONFIG.realmDefaultRadius * sx, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Entity dots
  for (const entity of opts.snapshot.entities) {
    const pos = opts.layout.get(entity.id);
    if (!pos) continue;
    const mx = (pos.x + WW / 2) * sx;
    const my = (pos.y + WH / 2) * sy;
    const active = entity.status !== 'idle' && entity.status !== 'unknown';
    ctx.fillStyle = active ? '#bae6fd' : '#71717a';
    const dotR = entity.typeId === 'mimir' ? 3 : 1.5;
    ctx.fillRect(mx - dotR / 2, my - dotR / 2, dotR, dotR);
  }

  // Viewport rect
  if (opts.canvasW && opts.zoom) {
    const vw = opts.canvasW / opts.zoom;
    const vh = opts.canvasH / opts.zoom;
    const vx = (opts.camX - vw / 2 + WW / 2) * sx;
    const vy = (opts.camY - vh / 2 + WH / 2) * sy;
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw * sx, vh * sy);
  }
}
