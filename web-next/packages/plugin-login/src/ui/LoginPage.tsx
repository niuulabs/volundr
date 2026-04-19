import { useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { LoginPageComponentProps } from '@niuulabs/auth';
import styles from './LoginPage.module.css';

// ---------------------------------------------------------------------------
// Logo — LogoKnot (two interlocked N's as Norse-knot braid)
// ---------------------------------------------------------------------------

interface LogoProps {
  size?: number;
  stroke?: number;
  glow?: boolean;
}

function LogoKnot({ size = 56, stroke = 1.6, glow = false }: LogoProps) {
  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      aria-hidden
      className={glow ? styles.logoGlow : undefined}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 44 V12 L28 38 V14" />
        <path d="M46 44 V16 L28 42 V14" opacity="0.85" />
        <circle cx="28" cy="28" r="1.6" fill="currentColor" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// NiuuWordmark
// ---------------------------------------------------------------------------

function NiuuWordmark({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }}>
      <strong>n</strong>iuu
    </span>
  );
}

// ---------------------------------------------------------------------------
// AmbientTopology — canvas-based node graph with pulsing nodes
// ---------------------------------------------------------------------------

const NODE_COUNT = 28;
const EDGE_DISTANCE = 180;

function AmbientTopology() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;
    type Node = { x: number; y: number; vx: number; vy: number; r: number; pulse: number };
    let nodes: Node[] = [];

    function seed(w: number, h: number) {
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        r: 1 + Math.random() * 1.6,
        pulse: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed(w, h);
    }

    function draw() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      ctx!.clearRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < EDGE_DISTANCE) {
            ctx!.strokeStyle = `rgba(125,211,252,${0.08 * (1 - d / EDGE_DISTANCE)})`;
            ctx!.lineWidth = 0.8;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        n.pulse += 0.01;
        const p = 0.5 + 0.5 * Math.sin(n.pulse);
        ctx!.fillStyle = `rgba(186,230,253,${0.35 + 0.35 * p})`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      rafId = requestAnimationFrame(draw);
    }

    resize();
    draw();

    const onResize = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      resize();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.ambient} aria-hidden />;
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

/** LoginPageProps re-uses the contract from @niuulabs/auth to keep them in sync. */
export type LoginPageProps = LoginPageComponentProps;

export function LoginPage({ onLogin, loading = false, error = null }: LoginPageProps): ReactNode {
  const buildLine = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `niuu · build ${y}.${m}.${d}-7f3a2c · valaskjálf`;
  }, []);

  return (
    <div className={styles.page} data-theme="ice" data-testid="login-page">
      <AmbientTopology />

      <div className={styles.buildLine} aria-hidden>
        <span className={styles.buildDot} />
        {buildLine}
      </div>

      <main className={styles.card}>
        <div className={styles.mark}>
          <LogoKnot size={72} stroke={1.6} glow />
        </div>

        <h1 className={styles.wordmarkHeading}>
          <NiuuWordmark size={44} />
        </h1>

        <p className={styles.tagline}>agentic infrastructure, braided</p>

        <div className={styles.divider}>
          <span>sign in</span>
        </div>

        {error && (
          <p className={styles.errorMsg} role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        <div className={styles.authArea}>
          <button
            className={styles.btnPrimary}
            onClick={onLogin}
            disabled={loading}
            data-testid="sign-in-button"
            aria-busy={loading}
          >
            {loading ? (
              <span className={styles.spinner} aria-label="Signing in…" />
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Sign in</span>
                <span className={styles.kbd}>↵</span>
              </>
            )}
          </button>
        </div>

        <div className={styles.foot}>
          <span className={styles.dim}>no account?</span>
          {/* TODO: wire to a real access-request flow */}
          <span className={styles.dim}>request access</span>
        </div>
      </main>
    </div>
  );
}
