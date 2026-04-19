import { cn } from '../../utils/cn';
import './ShapeSvg.css';

export type ShapeKind =
  | 'ring'
  | 'ring-dashed'
  | 'rounded-rect'
  | 'diamond'
  | 'triangle'
  | 'hex'
  | 'chevron'
  | 'square'
  | 'square-sm'
  | 'pentagon'
  | 'halo'
  | 'mimir'
  | 'mimir-small'
  | 'dot';

export interface ShapeSvgProps {
  shape: ShapeKind;
  /** Color token string, e.g. 'brand', 'ice-300', 'brand-400', 'slate-400' */
  color?: string;
  size?: number;
  className?: string;
  title?: string;
}

export function resolveShapeColor(color: string | undefined): string {
  if (!color) return 'var(--color-brand)';
  if (color.startsWith('ice-')) return `var(--brand-${color.split('-')[1]})`;
  if (color === 'brand') return 'var(--color-brand)';
  if (color.startsWith('brand-')) return `var(--brand-${color.split('-')[1]})`;
  if (color === 'slate-400') return 'var(--color-text-muted)';
  if (color.startsWith('slate-')) return 'var(--color-text-secondary)';
  return 'var(--color-brand)';
}

function ShapeBody({ shape, resolved }: { shape: ShapeKind; resolved: string }) {
  switch (shape) {
    case 'ring':
      return <circle cx="0" cy="0" r="7" fill="none" stroke={resolved} strokeWidth="1.4" />;
    case 'ring-dashed':
      return (
        <circle
          cx="0"
          cy="0"
          r="7"
          fill="none"
          stroke={resolved}
          strokeWidth="1.2"
          strokeDasharray="2 2"
        />
      );
    case 'rounded-rect':
      return (
        <rect
          x="-7"
          y="-5"
          width="14"
          height="10"
          rx="2"
          fill="none"
          stroke={resolved}
          strokeWidth="1.4"
        />
      );
    case 'diamond':
      return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill={resolved} opacity="0.85" />;
    case 'triangle':
      return <path d="M0,-7 L6,5 L-6,5 Z" fill={resolved} />;
    case 'hex':
      return (
        <path
          d="M-6,-3.5 L0,-7 L6,-3.5 L6,3.5 L0,7 L-6,3.5 Z"
          fill="none"
          stroke={resolved}
          strokeWidth="1.4"
        />
      );
    case 'chevron':
      return <path d="M-6,5 L0,-6 L6,5 L0,2 Z" fill={resolved} />;
    case 'square':
      return <rect x="-6" y="-6" width="12" height="12" rx="1" fill={resolved} />;
    case 'square-sm':
      return (
        <rect
          x="-5"
          y="-5"
          width="10"
          height="10"
          fill="none"
          stroke={resolved}
          strokeWidth="1.4"
        />
      );
    case 'pentagon':
      return <path d="M0,-7 L6.6,-2.2 L4.1,5.6 L-4.1,5.6 L-6.6,-2.2 Z" fill={resolved} />;
    case 'halo':
      return (
        <>
          <circle
            cx="0"
            cy="0"
            r="7"
            fill="none"
            stroke={resolved}
            strokeWidth="1"
            strokeDasharray="1 2"
          />
          <circle cx="0" cy="0" r="2.5" fill={resolved} />
        </>
      );
    case 'mimir':
    case 'mimir-small':
      return (
        <>
          <circle
            cx="0"
            cy="0"
            r="5"
            fill="var(--color-bg-primary)"
            stroke={resolved}
            strokeWidth="1.4"
          />
          <text
            x="0"
            y="1"
            fontSize="5"
            fill={resolved}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="monospace"
          >
            ᛗ
          </text>
        </>
      );
    case 'dot':
    default:
      return <circle cx="0" cy="0" r="4" fill={resolved} />;
  }
}

export function ShapeSvg({ shape, color, size = 20, className, title }: ShapeSvgProps) {
  const resolved = resolveShapeColor(color);
  return (
    <svg
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('niuu-shape-svg', className)}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <ShapeBody shape={shape} resolved={resolved} />
    </svg>
  );
}
