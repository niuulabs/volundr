import type { Meta, StoryObj } from '@storybook/react';
import { ShapeSvg, type ShapeKind } from './ShapeSvg';

const ALL_SHAPES: ShapeKind[] = [
  'ring',
  'ring-dashed',
  'rounded-rect',
  'diamond',
  'triangle',
  'hex',
  'chevron',
  'square',
  'square-sm',
  'pentagon',
  'halo',
  'mimir',
  'mimir-small',
  'dot',
];

const meta: Meta<typeof ShapeSvg> = {
  title: 'Primitives/ShapeSvg',
  component: ShapeSvg,
  args: { shape: 'ring', color: 'brand', size: 20 },
  argTypes: {
    shape: { control: 'select', options: ALL_SHAPES },
    size: { control: { type: 'number', min: 8, max: 64, step: 4 } },
  },
};
export default meta;

type Story = StoryObj<typeof ShapeSvg>;

// ── Individual shapes ────────────────────────────────────────────

export const Ring: Story = { args: { shape: 'ring' } };
export const RingDashed: Story = { args: { shape: 'ring-dashed' } };
export const RoundedRect: Story = { args: { shape: 'rounded-rect' } };
export const Diamond: Story = { args: { shape: 'diamond' } };
export const Triangle: Story = { args: { shape: 'triangle' } };
export const Hex: Story = { args: { shape: 'hex' } };
export const Chevron: Story = { args: { shape: 'chevron' } };
export const Square: Story = { args: { shape: 'square' } };
export const SquareSm: Story = { args: { shape: 'square-sm' } };
export const Pentagon: Story = { args: { shape: 'pentagon' } };
export const Halo: Story = { args: { shape: 'halo' } };
export const Mimir: Story = { args: { shape: 'mimir', size: 36 } };
export const MimirSmall: Story = { args: { shape: 'mimir-small' } };
export const Dot: Story = { args: { shape: 'dot' } };

// ── Grid: every shape at 20×20 ───────────────────────────────────

export const AllShapes20: Story = {
  name: 'All Shapes — 20×20',
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 24,
        alignItems: 'center',
        justifyItems: 'center',
        padding: 24,
        background: 'var(--color-bg-primary, #09090b)',
      }}
    >
      {ALL_SHAPES.map((shape) => (
        <div
          key={shape}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
        >
          <ShapeSvg shape={shape} color="brand" size={20} title={shape} />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 10,
              color: 'var(--color-text-muted, #71717a)',
            }}
          >
            {shape}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Grid: every shape at 36×36 ───────────────────────────────────

export const AllShapes36: Story = {
  name: 'All Shapes — 36×36',
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 32,
        alignItems: 'center',
        justifyItems: 'center',
        padding: 32,
        background: 'var(--color-bg-primary, #09090b)',
      }}
    >
      {ALL_SHAPES.map((shape) => (
        <div
          key={shape}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
        >
          <ShapeSvg shape={shape} color="brand" size={36} title={shape} />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 10,
              color: 'var(--color-text-muted, #71717a)',
            }}
          >
            {shape}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Color variants ───────────────────────────────────────────────

export const ColorVariants: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        gap: 20,
        alignItems: 'center',
        padding: 20,
        background: 'var(--color-bg-primary, #09090b)',
      }}
    >
      {(['brand', 'ice-100', 'ice-300', 'brand-400', 'slate-400', 'slate-300'] as const).map(
        (color) => (
          <div
            key={color}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
          >
            <ShapeSvg shape="diamond" color={color} size={28} title={color} />
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 9,
                color: 'var(--color-text-muted, #71717a)',
              }}
            >
              {color}
            </span>
          </div>
        ),
      )}
    </div>
  ),
};

// ── Entity-type palette (matches DEFAULT_REGISTRY shapes) ────────

const ENTITY_SWATCHES: Array<{ label: string; shape: ShapeKind; color: string }> = [
  { label: 'realm', shape: 'ring', color: 'ice-100' },
  { label: 'cluster', shape: 'ring-dashed', color: 'ice-200' },
  { label: 'host', shape: 'rounded-rect', color: 'slate-400' },
  { label: 'ravn', shape: 'diamond', color: 'brand' },
  { label: 'raid ravn', shape: 'triangle', color: 'ice-300' },
  { label: 'skuld', shape: 'hex', color: 'ice-200' },
  { label: 'valkyrie', shape: 'chevron', color: 'brand-400' },
  { label: 'tyr', shape: 'square', color: 'brand' },
  { label: 'bifrost', shape: 'pentagon', color: 'brand' },
  { label: 'mimir', shape: 'mimir', color: 'ice-100' },
  { label: 'mimir sub', shape: 'mimir-small', color: 'ice-200' },
  { label: 'service', shape: 'dot', color: 'ice-300' },
  { label: 'raid', shape: 'halo', color: 'brand' },
];

export const EntityPalette: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 20,
        padding: 20,
        background: 'var(--color-bg-primary, #09090b)',
      }}
    >
      {ENTITY_SWATCHES.map(({ label, shape, color }) => (
        <div
          key={label}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
        >
          <ShapeSvg shape={shape} color={color} size={28} title={label} />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 9,
              color: 'var(--color-text-muted, #71717a)',
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  ),
};
