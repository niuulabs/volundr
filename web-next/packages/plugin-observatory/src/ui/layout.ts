/**
 * Deterministic layout engine for the TopologyCanvas.
 *
 * All functions are pure — no React, no side effects.
 * Positions are in world space where Mímir anchors at (0, 0).
 */
import { CANVAS_CONFIG } from './canvasConfig';
import type { TopologyEntity, TopologySnapshot } from '../domain/topology';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Immutable snapshot of computed entity positions (entity id → world Point). */
export type LayoutMap = ReadonlyMap<string, Point>;

// ── Hash helpers ────────────────────────────────────────────────────────────

/**
 * Maps an entity id to a stable fraction in [0, 1).
 * Uses a simple polynomial hash so equal ids always produce equal fractions.
 */
export function idFraction(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000;
}

// ── Zoom / pan math ─────────────────────────────────────────────────────────

/**
 * Clamp zoom level to configured min/max.
 * This is a pure function — call it before mutating camera state.
 */
export function clampZoom(zoom: number): number {
  return Math.max(CANVAS_CONFIG.minZoom, Math.min(CANVAS_CONFIG.maxZoom, zoom));
}

/**
 * Convert a screen-space coordinate (e.g. mouse position) to world space,
 * given the current camera and canvas dimensions.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  canvasW: number,
  canvasH: number,
  camX: number,
  camY: number,
  zoom: number,
): Point {
  return {
    x: (sx - canvasW / 2) / zoom + camX,
    y: (sy - canvasH / 2) / zoom + camY,
  };
}

/**
 * Zoom toward a mouse position, keeping the world point under the cursor fixed.
 * Returns the new camera state.
 */
export function applyScrollZoom(opts: {
  currentZoom: number;
  deltaY: number;
  mouseX: number;
  mouseY: number;
  canvasW: number;
  canvasH: number;
  camX: number;
  camY: number;
}): { newZoom: number; newCamX: number; newCamY: number } {
  const { currentZoom, deltaY, mouseX, mouseY, canvasW, canvasH, camX, camY } = opts;
  const factor = deltaY < 0 ? CANVAS_CONFIG.zoomStep : 1 / CANVAS_CONFIG.zoomStep;
  const newZoom = clampZoom(currentZoom * factor);
  const newCamX = (mouseX - canvasW / 2) / currentZoom + camX - (mouseX - canvasW / 2) / newZoom;
  const newCamY = (mouseY - canvasH / 2) / currentZoom + camY - (mouseY - canvasH / 2) / newZoom;
  return { newZoom, newCamX, newCamY };
}

// ── Layout computation ───────────────────────────────────────────────────────

/**
 * Compute deterministic world-space positions for every entity in a snapshot.
 *
 * Layout rules (all positions in world space, Mímir at origin):
 * 1. mimir       → (0, 0)
 * 2. mimir_sub   → ring around mimir
 * 3. realm       → sorted alphabetically by id, distributed evenly on a ring
 *                  with a small per-id hash offset for visual spread
 * 4. cluster     → inside parent realm, hash-based angle
 * 5. host        → outer ring of parent realm, with collision avoidance
 * 6. everything else → inside parent container, hash angle + type-based radius
 */
export function computeLayout(snapshot: TopologySnapshot): LayoutMap {
  const positions = new Map<string, Point>();

  const byType = groupByType(snapshot.entities);

  placeAtOrigin(byType.get('mimir') ?? [], positions);
  placeSubMimirs(byType.get('mimir_sub') ?? [], positions);
  const realmPos = placeRealms(byType.get('realm') ?? [], positions);
  const clusterPos = placeClusters(byType.get('cluster') ?? [], realmPos, positions);
  placeHosts(byType.get('host') ?? [], realmPos, clusterPos, positions);
  placeRemaining(snapshot.entities, realmPos, clusterPos, positions);

  return positions;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function groupByType(entities: TopologyEntity[]): Map<string, TopologyEntity[]> {
  const map = new Map<string, TopologyEntity[]>();
  for (const e of entities) {
    const arr = map.get(e.typeId) ?? [];
    arr.push(e);
    map.set(e.typeId, arr);
  }
  return map;
}

function placeAtOrigin(mimirs: TopologyEntity[], out: Map<string, Point>): void {
  for (const m of mimirs) {
    out.set(m.id, { x: 0, y: 0 });
  }
}

function placeSubMimirs(subMimirs: TopologyEntity[], out: Map<string, Point>): void {
  const count = subMimirs.length;
  subMimirs.forEach((sm, i) => {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    out.set(sm.id, {
      x: Math.cos(angle) * CANVAS_CONFIG.subMimirRingRadius,
      y: Math.sin(angle) * CANVAS_CONFIG.subMimirRingRadius,
    });
  });
}

function placeRealms(
  realms: TopologyEntity[],
  out: Map<string, Point>,
): Map<string, Point> {
  // Sort for stable ordering across re-renders.
  const sorted = [...realms].sort((a, b) => a.id.localeCompare(b.id));
  const realmPos = new Map<string, Point>();
  const count = sorted.length;

  sorted.forEach((realm, i) => {
    const baseAngle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    // Small per-id angular jitter so realms don't stack when count changes.
    const jitter = (idFraction(realm.id) - 0.5) * 0.35;
    const angle = baseAngle + jitter;
    const pos: Point = {
      x: Math.cos(angle) * CANVAS_CONFIG.realmRingRadius,
      y: Math.sin(angle) * CANVAS_CONFIG.realmRingRadius,
    };
    out.set(realm.id, pos);
    realmPos.set(realm.id, pos);
  });

  return realmPos;
}

function placeClusters(
  clusters: TopologyEntity[],
  realmPos: Map<string, Point>,
  out: Map<string, Point>,
): Map<string, Point> {
  const clusterPos = new Map<string, Point>();

  for (const cluster of clusters) {
    const parentPos = cluster.parentId ? (realmPos.get(cluster.parentId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const parentR = CANVAS_CONFIG.realmDefaultRadius;
    const angle = idFraction(cluster.id) * Math.PI * 2;
    const dist = parentR * CANVAS_CONFIG.clusterRingFactor;
    const pos: Point = {
      x: parentPos.x + Math.cos(angle) * dist,
      y: parentPos.y + Math.sin(angle) * dist,
    };
    out.set(cluster.id, pos);
    clusterPos.set(cluster.id, pos);
  }

  return clusterPos;
}

function placeHosts(
  hosts: TopologyEntity[],
  realmPos: Map<string, Point>,
  clusterPos: Map<string, Point>,
  out: Map<string, Point>,
): void {
  // Group by parent realm
  const byRealm = new Map<string, TopologyEntity[]>();
  for (const h of hosts) {
    const key = h.parentId ?? '__root';
    const arr = byRealm.get(key) ?? [];
    arr.push(h);
    byRealm.set(key, arr);
  }

  byRealm.forEach((realmHosts, realmId) => {
    const rp = realmPos.get(realmId) ?? { x: 0, y: 0 };
    const rr = CANVAS_CONFIG.realmDefaultRadius;
    const ring = rr * CANVAS_CONFIG.hostRingFactor;

    realmHosts.forEach((host, i) => {
      const baseAngle =
        (i / Math.max(1, realmHosts.length)) * Math.PI * 2 +
        Math.PI * 0.6 +
        idFraction(host.id) * 0.4;

      const finalAngle = findHostAngle(
        baseAngle,
        rp,
        ring,
        host,
        realmHosts.slice(0, i),
        clusterPos,
        out,
      );

      out.set(host.id, {
        x: rp.x + Math.cos(finalAngle) * ring,
        y: rp.y + Math.sin(finalAngle) * ring,
      });
    });
  });
}

function findHostAngle(
  startAngle: number,
  realmCenter: Point,
  ring: number,
  _host: TopologyEntity,
  previousHosts: TopologyEntity[],
  clusterPos: Map<string, Point>,
  placed: Map<string, Point>,
): number {
  const step = (Math.PI * 2) / CANVAS_CONFIG.hostCollisionAttempts;
  const hostR = CANVAS_CONFIG.nodeSizes.host;

  for (let attempt = 0; attempt < CANVAS_CONFIG.hostCollisionAttempts; attempt++) {
    const testAngle = startAngle + attempt * step;
    const tx = realmCenter.x + Math.cos(testAngle) * ring;
    const ty = realmCenter.y + Math.sin(testAngle) * ring;

    if (collidesWithClusters(tx, ty, hostR, clusterPos)) continue;
    if (collidesWithPlacedHosts(tx, ty, hostR, previousHosts, placed)) continue;

    return testAngle;
  }

  return startAngle; // fallback: no collision-free slot found
}

function collidesWithClusters(
  tx: number,
  ty: number,
  hostR: number,
  clusterPos: Map<string, Point>,
): boolean {
  for (const cp of clusterPos.values()) {
    const cr = CANVAS_CONFIG.clusterDefaultRadius;
    if (Math.hypot(tx - cp.x, ty - cp.y) < cr + hostR + CANVAS_CONFIG.hostCollisionGap) {
      return true;
    }
  }
  return false;
}

function collidesWithPlacedHosts(
  tx: number,
  ty: number,
  hostR: number,
  previousHosts: TopologyEntity[],
  placed: Map<string, Point>,
): boolean {
  for (const prev of previousHosts) {
    const prevPos = placed.get(prev.id);
    if (!prevPos) continue;
    if (Math.hypot(tx - prevPos.x, ty - prevPos.y) < hostR * 2.8) {
      return true;
    }
  }
  return false;
}

/** Place all entity types not explicitly handled above. */
function placeRemaining(
  entities: TopologyEntity[],
  realmPos: Map<string, Point>,
  clusterPos: Map<string, Point>,
  out: Map<string, Point>,
): void {
  const HANDLED = new Set(['mimir', 'mimir_sub', 'realm', 'cluster', 'host']);

  for (const entity of entities) {
    if (HANDLED.has(entity.typeId)) continue;
    if (out.has(entity.id)) continue;

    const parentPos = resolveParentPos(entity.parentId, realmPos, clusterPos, out);
    const parentR = resolveParentRadius(entity.parentId, realmPos, clusterPos);
    const angle = idFraction(entity.id) * Math.PI * 2;
    const dist = typeRadiusFraction(entity.typeId) * parentR;

    out.set(entity.id, {
      x: parentPos.x + Math.cos(angle) * dist,
      y: parentPos.y + Math.sin(angle) * dist,
    });
  }
}

function resolveParentPos(
  parentId: string | null,
  realmPos: Map<string, Point>,
  clusterPos: Map<string, Point>,
  out: Map<string, Point>,
): Point {
  if (!parentId) return { x: 0, y: 0 };
  return clusterPos.get(parentId) ?? realmPos.get(parentId) ?? out.get(parentId) ?? { x: 0, y: 0 };
}

function resolveParentRadius(
  parentId: string | null,
  realmPos: Map<string, Point>,
  clusterPos: Map<string, Point>,
): number {
  if (!parentId) return CANVAS_CONFIG.realmDefaultRadius;
  if (clusterPos.has(parentId)) return CANVAS_CONFIG.clusterDefaultRadius;
  if (realmPos.has(parentId)) return CANVAS_CONFIG.realmDefaultRadius;
  return CANVAS_CONFIG.clusterDefaultRadius;
}

function typeRadiusFraction(typeId: string): number {
  switch (typeId) {
    case 'service':   return CANVAS_CONFIG.serviceRingFactor;
    case 'model':     return CANVAS_CONFIG.modelFanRadius / CANVAS_CONFIG.clusterDefaultRadius;
    case 'valkyrie':  return CANVAS_CONFIG.valkyrieRingFactor;
    case 'raid':      return CANVAS_CONFIG.raidRingFactor;
    case 'ravn_long': return CANVAS_CONFIG.ravnLongRingFactor;
    case 'ravn_raid': return CANVAS_CONFIG.ravnRaidRingFactor;
    case 'skuld':     return CANVAS_CONFIG.skuldRingFactor;
    default:          return CANVAS_CONFIG.defaultRingFactor;
  }
}
