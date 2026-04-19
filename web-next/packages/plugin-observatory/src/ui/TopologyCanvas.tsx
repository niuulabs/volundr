import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CANVAS_CONFIG } from './canvasConfig';
import { computeLayout, screenToWorld, applyScrollZoom, clampZoom } from './layout';
import {
  drawStars,
  drawRealmRing,
  drawClusterRing,
  drawConnections,
  drawMimir,
  drawNode,
  drawMinimap,
  nodeSize,
} from './canvasRenderer';
import type { TopologySnapshot } from '../domain/topology';
import styles from './TopologyCanvas.module.css';

// ── Camera state ──────────────────────────────────────────────────────────

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const DEFAULT_CAMERA: Camera = {
  x: CANVAS_CONFIG.initialCamX,
  y: CANVAS_CONFIG.initialCamY,
  zoom: CANVAS_CONFIG.initialZoom,
};

// ── Props ─────────────────────────────────────────────────────────────────

export interface TopologyCanvasProps {
  /** Live topology snapshot from ILiveTopologyStream. Renders empty state when null. */
  snapshot: TopologySnapshot | null;
  /** Show the minimap overlay (default: true). */
  showMinimap?: boolean;
  /** Called when an entity is clicked. */
  onEntityClick?: (entityId: string) => void;
  /** Accessible label for the canvas element. */
  ariaLabel?: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function TopologyCanvas({
  snapshot,
  showMinimap = true,
  onEntityClick,
  ariaLabel = 'Topology canvas',
}: TopologyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Camera in a ref so the rAF loop always reads the latest value without deps.
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA });

  // Canvas pixel size (logical, not physical).
  const sizeRef = useRef({ w: 0, h: 0 });

  // Force re-render for zoom% display and minimap reactivity.
  const [, forceUpdate] = useState(0);
  const tick = useCallback(() => forceUpdate((n) => n + 1), []);

  // Drag state
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startCamX: 0, startCamY: 0 });

  // Hovered entity id
  const hoveredIdRef = useRef<string | null>(null);

  // Layout — recomputed when snapshot changes.
  const layout = snapshot ? computeLayout(snapshot) : new Map();

  // ── Canvas setup + ResizeObserver ────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applySize = (w: number, h: number) => {
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
    };

    applySize(canvas.clientWidth, canvas.clientHeight);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      applySize(width, height);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Scroll-wheel zoom (clamped 0.3×–3×) ─────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const { w, h } = sizeRef.current;
      const { newZoom, newCamX, newCamY } = applyScrollZoom({
        currentZoom: camRef.current.zoom,
        deltaY: e.deltaY,
        mouseX: e.clientX - rect.left,
        mouseY: e.clientY - rect.top,
        canvasW: w,
        canvasH: h,
        camX: camRef.current.x,
        camY: camRef.current.y,
      });
      camRef.current = { x: newCamX, y: newCamY, zoom: newZoom };
      tick();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [tick]);

  // ── Keyboard pan ────────────────────────────────────────────────────────

  useEffect(() => {
    const step = CANVAS_CONFIG.keyPanStep;

    const onKeyDown = (e: KeyboardEvent) => {
      // Pan when the observatory wrap or any child is the active element,
      // or when focus is on the body (no other component has claimed focus).
      const wrap = canvasRef.current?.closest<HTMLElement>('[data-topology-canvas]');
      const activeEl = document.activeElement;
      const isFocused =
        !activeEl ||
        activeEl === document.body ||
        (wrap && (wrap === activeEl || wrap.contains(activeEl)));
      if (!isFocused) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          camRef.current.y -= step / camRef.current.zoom;
          tick();
          break;
        case 'ArrowDown':
          e.preventDefault();
          camRef.current.y += step / camRef.current.zoom;
          tick();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          camRef.current.x -= step / camRef.current.zoom;
          tick();
          break;
        case 'ArrowRight':
          e.preventDefault();
          camRef.current.x += step / camRef.current.zoom;
          tick();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tick]);

  // ── Render loop ──────────────────────────────────────────────────────────

  // Keep snapshot + layout in refs so the rAF closure is stable.
  const renderDataRef = useRef({ snapshot, layout, showMinimap });
  renderDataRef.current = { snapshot, layout, showMinimap };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const render = (now: number) => {
      if (cancelled) return;

      const { snapshot: snap, layout: lay, showMinimap: mini } = renderDataRef.current;
      const { w, h } = sizeRef.current;
      if (!w || !h) return;

      const dpr = window.devicePixelRatio || 1;
      const cam = camRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#0a0c12');
      bg.addColorStop(1, '#050509');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      drawStars(ctx, w, h, now);

      if (!snap) {
        // Empty state label
        ctx.fillStyle = 'rgba(148,163,184,0.45)';
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for topology data…', w / 2, h / 2);
        ctx.textBaseline = 'alphabetic';
        return;
      }

      // World transform: centre + zoom + camera pan.
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // Draw zones (realms then clusters).
      for (const entity of snap.entities) {
        if (entity.typeId === 'realm') {
          const pos = lay.get(entity.id);
          if (!pos) continue;
          const vlan =
            typeof entity.fields['vlan'] === 'number' ? entity.fields['vlan'] : undefined;
          const dns = typeof entity.fields['dns'] === 'string' ? entity.fields['dns'] : undefined;
          drawRealmRing(ctx, pos, CANVAS_CONFIG.realmDefaultRadius, entity.name, now, vlan, dns);
        }
      }
      for (const entity of snap.entities) {
        if (entity.typeId === 'cluster') {
          const pos = lay.get(entity.id);
          if (!pos) continue;
          drawClusterRing(ctx, pos, CANVAS_CONFIG.clusterDefaultRadius, entity.name);
        }
      }

      // Draw connections.
      drawConnections(ctx, snap.connections, lay, now);

      // Draw Mímir last among special nodes (above connections, below labels).
      for (const entity of snap.entities) {
        if (entity.typeId !== 'mimir' && entity.typeId !== 'mimir_sub') continue;
        const pos = lay.get(entity.id);
        if (!pos) continue;
        const label = entity.typeId === 'mimir' ? 'MÍMIR' : entity.name;
        const scale = entity.typeId === 'mimir' ? 1.0 : 0.4;
        drawMimir(ctx, pos, now, scale, label);
      }

      // Draw all other nodes.
      const hoveredId = hoveredIdRef.current;
      for (const entity of snap.entities) {
        if (entity.typeId === 'mimir' || entity.typeId === 'mimir_sub') continue;
        if (entity.typeId === 'realm' || entity.typeId === 'cluster') continue;
        const pos = lay.get(entity.id);
        if (!pos) continue;
        drawNode(ctx, entity, pos, now, entity.id === hoveredId);
      }

      ctx.restore();

      // Minimap (screen space, no world transform).
      if (mini) {
        const mmCanvas = minimapRef.current;
        if (mmCanvas) {
          const mmCtx = mmCanvas.getContext('2d');
          if (mmCtx) {
            drawMinimap(mmCtx, {
              snapshot: snap,
              layout: lay,
              camX: cam.x,
              camY: cam.y,
              zoom: cam.zoom,
              canvasW: w,
              canvasH: h,
            });
          }
        }
      }
    };

    // Drive with setInterval + rAF for reliability in preview iframes.
    const tickLoop = () => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(render);
    };
    render(performance.now());
    intervalRef.current = setInterval(tickLoop, CANVAS_CONFIG.rafIntervalMs);

    return () => {
      cancelled = true;
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // stable: only runs once; reads fresh data via renderDataRef

  // ── Hit testing ──────────────────────────────────────────────────────────

  const hitTest = useCallback(
    (sx: number, sy: number): string | null => {
      if (!snapshot) return null;
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      const { x: wx, y: wy } = screenToWorld(sx, sy, w, h, cam.x, cam.y, cam.zoom);

      for (const entity of snapshot.entities) {
        const pos = layout.get(entity.id);
        if (!pos) continue;

        if (entity.typeId === 'host') {
          const size = CANVAS_CONFIG.nodeSizes.host;
          const hw = size * 2.4;
          const hh = size * 1.6;
          if (Math.abs(wx - pos.x) < hw / 2 && Math.abs(wy - pos.y) < hh / 2) {
            return entity.id;
          }
          continue;
        }

        const hitR = nodeSize(entity.typeId) + 6;
        if (Math.hypot(wx - pos.x, wy - pos.y) < hitR) {
          return entity.id;
        }
      }
      return null;
    },
    [snapshot, layout],
  );

  // ── Pointer handlers ─────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const drag = dragRef.current;
      if (drag.active) {
        camRef.current.x = drag.startCamX - (sx - drag.startX) / camRef.current.zoom;
        camRef.current.y = drag.startCamY - (sy - drag.startY) / camRef.current.zoom;
        canvas.style.cursor = 'grabbing';
        tick();
        return;
      }

      const hitId = hitTest(sx, sy);
      hoveredIdRef.current = hitId;
      canvas.style.cursor = hitId ? 'pointer' : 'grab';
    },
    [hitTest, tick],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (hitTest(sx, sy)) return; // let click handle entity selection

      dragRef.current = {
        active: true,
        startX: sx,
        startY: sy,
        startCamX: camRef.current.x,
        startCamY: camRef.current.y,
      };
      canvas.style.cursor = 'grabbing';
    },
    [hitTest],
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, []);

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hitId = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hitId) onEntityClick?.(hitId);
    },
    [hitTest, onEntityClick],
  );

  const handleLeave = useCallback(() => {
    dragRef.current.active = false;
    hoveredIdRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, []);

  // ── Camera control buttons ───────────────────────────────────────────────

  const zoomIn = () => {
    camRef.current.zoom = clampZoom(camRef.current.zoom * CANVAS_CONFIG.zoomStep);
    tick();
  };

  const zoomOut = () => {
    camRef.current.zoom = clampZoom(camRef.current.zoom / CANVAS_CONFIG.zoomStep);
    tick();
  };

  const resetCamera = () => {
    camRef.current = { ...DEFAULT_CAMERA };
    tick();
  };

  const handleMinimapClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const mm = minimapRef.current;
    if (!mm) return;
    const rect = mm.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    camRef.current.x = (fx - 0.5) * CANVAS_CONFIG.worldWidth;
    camRef.current.y = (fy - 0.5) * CANVAS_CONFIG.worldHeight;
    tick();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const zoomPct = Math.round(camRef.current.zoom * 100);

  return (
    <div className={styles.wrap} data-topology-canvas tabIndex={-1}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label={ariaLabel}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleLeave}
        onClick={handleClick}
      />

      <div className={styles.controls}>
        <button className={styles.controlBtn} onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <span className={styles.zoomLabel}>{zoomPct}%</span>
        <button
          className={styles.controlBtn}
          onClick={zoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <div className={styles.sep} />
        <button
          className={styles.controlBtn}
          onClick={resetCamera}
          aria-label="Reset camera"
          title="Reset camera"
        >
          ⊙
        </button>
      </div>

      {showMinimap && (
        <div className={styles.minimap}>
          <canvas
            ref={minimapRef}
            width={CANVAS_CONFIG.minimapWidth}
            height={CANVAS_CONFIG.minimapHeight}
            className={styles.minimapCanvas}
            aria-label="Topology minimap"
            onClick={handleMinimapClick}
          />
          <div className={styles.minimapCaption}>
            <span>MINIMAP</span>
            <span>{snapshot?.entities.length ?? 0} entities</span>
          </div>
        </div>
      )}
    </div>
  );
}
