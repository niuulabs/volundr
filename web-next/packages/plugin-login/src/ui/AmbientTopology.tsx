import { useEffect, useRef } from 'react';
import './ambient.css';

const NODE_COUNT = 28;
const EDGE_DISTANCE = 180;
const NODE_SPEED = 0.08;
const PULSE_INCREMENT = 0.01;

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pulse: number;
}

function seedNodes(w: number, h: number): Node[] {
  return Array.from({ length: NODE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * NODE_SPEED,
    vy: (Math.random() - 0.5) * NODE_SPEED,
    r: 1 + Math.random() * 1.6,
    pulse: Math.random() * Math.PI * 2,
  }));
}

/**
 * Topology ambient — a slow-moving node graph with faint ice-blue edges.
 *
 * Animation pauses when `prefers-reduced-motion: reduce` is set.
 */
export function AmbientTopology() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let nodes: Node[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = seedNodes(canvas.clientWidth, canvas.clientHeight);
    };

    const drawFrame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < EDGE_DISTANCE) {
            ctx.strokeStyle = `rgba(125,211,252,${0.08 * (1 - d / EDGE_DISTANCE)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        n.pulse += PULSE_INCREMENT;
        const p = 0.5 + 0.5 * Math.sin(n.pulse);
        ctx.fillStyle = `rgba(186,230,253,${0.35 + 0.35 * p})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(drawFrame);
    };

    resize();

    if (!prefersReduced) {
      drawFrame();
    } else {
      // Render a static snapshot without animating
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        ctx.fillStyle = 'rgba(186,230,253,0.5)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const onResize = () => {
      cancelAnimationFrame(rafId);
      resize();
      if (!prefersReduced) drawFrame();
    };

    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="login-ambient" aria-hidden data-testid="ambient-topology" />
  );
}
