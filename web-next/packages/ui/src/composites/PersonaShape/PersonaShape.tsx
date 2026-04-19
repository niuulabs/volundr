/**
 * PersonaShape — SVG shape primitives for persona role rendering.
 *
 * Each shape maps to a canonical role (see ROLE_SHAPE_MAP in PersonaAvatar).
 * Shapes are rendered on a -10..10 viewBox centered at (0,0).
 *
 * @see PersonaAvatar, RavnAvatar
 */

import type { PersonaRole } from '@niuulabs/domain';

export type PersonaShapeKind =
  | 'triangle'
  | 'square'
  | 'ring'
  | 'halo'
  | 'hex'
  | 'chevron'
  | 'ring-dashed'
  | 'mimir-small'
  | 'pentagon';

/**
 * Deterministic role → shape mapping.
 * Same role always yields the same shape — tested for determinism.
 */
export const ROLE_SHAPE_MAP: Record<PersonaRole, PersonaShapeKind> = {
  plan: 'triangle',
  build: 'square',
  verify: 'ring',
  review: 'halo',
  gate: 'hex',
  audit: 'chevron',
  ship: 'ring-dashed',
  index: 'mimir-small',
  report: 'pentagon',
};

export interface PersonaShapeProps {
  shape: PersonaShapeKind;
  size?: number;
  strokeWidth?: number;
  color?: string;
  fill?: string;
  className?: string;
}

export function PersonaShape({
  shape,
  size = 22,
  strokeWidth = 1.4,
  color = 'var(--brand-300)',
  fill = 'color-mix(in srgb, var(--brand-500) 14%, transparent)',
  className,
}: PersonaShapeProps) {
  const h = size / 2;
  const r = h - strokeWidth;
  const vb = `${-h} ${-h} ${size} ${size}`;
  const svgProps = {
    width: size,
    height: size,
    viewBox: vb,
    className,
    'aria-hidden': true as const,
    style: { flexShrink: 0 },
  };

  switch (shape) {
    case 'ring':
      return (
        <svg {...svgProps}>
          <circle cx="0" cy="0" r={r} fill={fill} stroke={color} strokeWidth={strokeWidth} />
        </svg>
      );

    case 'ring-dashed':
      return (
        <svg {...svgProps}>
          <circle
            cx="0"
            cy="0"
            r={r}
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray="2 2"
          />
        </svg>
      );

    case 'triangle': {
      const sw = strokeWidth;
      return (
        <svg {...svgProps}>
          <path
            d={`M0,${-h + sw} L${h - sw},${h - sw} L${-h + sw},${h - sw} Z`}
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    case 'square': {
      const sw = strokeWidth;
      return (
        <svg {...svgProps}>
          <rect
            x={-h + sw}
            y={-h + sw}
            width={size - 2 * sw}
            height={size - 2 * sw}
            rx="2"
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
          />
        </svg>
      );
    }

    case 'hex': {
      const dx = size * 0.18;
      const sw = strokeWidth;
      return (
        <svg {...svgProps}>
          <path
            d={`M${dx - h},0 L0,${-h + sw} L${h - dx},0 L${h - dx},${0} L0,${h - sw} L${dx - h},${0} Z`}
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    case 'chevron': {
      const sw = strokeWidth;
      return (
        <svg {...svgProps}>
          <path
            d={`M${-h + sw},${h - sw} L0,${-h + sw + size * 0.1} L${h - sw},${h - sw} L0,${size * 0.66 - h} Z`}
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    case 'pentagon': {
      const sw = strokeWidth;
      return (
        <svg {...svgProps}>
          <path
            d={`M0,${-h + sw} L${h - sw},${size * 0.42 - h} L${size * 0.82 - h},${h - sw} L${-size * 0.82 + h},${h - sw} L${-h + sw},${size * 0.42 - h} Z`}
            fill={fill}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    case 'halo': {
      return (
        <svg {...svgProps}>
          <circle
            cx="0"
            cy="0"
            r={r}
            fill="none"
            stroke={color}
            strokeOpacity="0.35"
            strokeWidth={strokeWidth}
            strokeDasharray="1 2"
          />
          <circle cx="0" cy="0" r={size * 0.18} fill={color} />
        </svg>
      );
    }

    case 'mimir-small': {
      return (
        <svg {...svgProps}>
          <circle
            cx="0"
            cy="0"
            r={h * 0.6}
            fill="var(--color-bg-secondary, #18181b)"
            stroke={color}
            strokeWidth={strokeWidth}
          />
          <text
            x="0"
            y="0"
            fontSize={h * 0.55}
            fill={color}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="var(--font-mono, monospace)"
          >
            ᛗ
          </text>
        </svg>
      );
    }
  }
}
