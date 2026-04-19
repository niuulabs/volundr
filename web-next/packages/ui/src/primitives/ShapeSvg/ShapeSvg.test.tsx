import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ShapeSvg, resolveShapeColor, type ShapeKind } from './ShapeSvg';
import {
  ENTITY_RUNES,
  SYSTEM_RUNES,
  PERSONA_RUNES,
  FORBIDDEN_RUNES,
  type EntityKind,
  type SystemComponent,
  type PersonaRole,
} from './runeGlyphMap';

// ── ShapeSvg component ────────────────────────────────────────────

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

describe('ShapeSvg', () => {
  describe('renders valid SVG for every shape', () => {
    for (const shape of ALL_SHAPES) {
      it(`renders <svg> for shape="${shape}"`, () => {
        const { container: c } = render(<ShapeSvg shape={shape} />);
        const svg = c.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('viewBox')).toBe('-10 -10 20 20');
      });
    }
  });

  it('sets width and height from size prop', () => {
    const { container: c } = render(<ShapeSvg shape="ring" size={36} />);
    const svg = c.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('36');
    expect(svg?.getAttribute('height')).toBe('36');
  });

  it('defaults to size=20', () => {
    const { container: c } = render(<ShapeSvg shape="dot" />);
    const svg = c.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('applies extra className', () => {
    const { container: c } = render(<ShapeSvg shape="square" className="my-shape" />);
    const svg = c.querySelector('svg');
    expect(svg?.classList.contains('niuu-shape-svg')).toBe(true);
    expect(svg?.classList.contains('my-shape')).toBe(true);
  });

  it('is aria-hidden when no title', () => {
    const { container: c } = render(<ShapeSvg shape="dot" />);
    const svg = c.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('aria-label')).toBeNull();
  });

  it('exposes title via aria-label and <title> element', () => {
    const { container: c } = render(<ShapeSvg shape="ring" title="Realm boundary" />);
    const svg = c.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe('Realm boundary');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.querySelector('title')?.textContent).toBe('Realm boundary');
  });

  it('ring-dashed has a strokeDasharray attribute', () => {
    const { container: c } = render(<ShapeSvg shape="ring-dashed" />);
    const circle = c.querySelector('circle');
    expect(circle?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('halo renders two circles', () => {
    const { container: c } = render(<ShapeSvg shape="halo" />);
    const circles = c.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
  });

  it('mimir renders a circle and a text element with ᛗ', () => {
    const { container: c } = render(<ShapeSvg shape="mimir" />);
    expect(c.querySelector('circle')).not.toBeNull();
    const text = c.querySelector('text');
    expect(text?.textContent).toBe('ᛗ');
  });

  it('mimir-small renders the same as mimir', () => {
    const { container: c } = render(<ShapeSvg shape="mimir-small" />);
    expect(c.querySelector('text')?.textContent).toBe('ᛗ');
  });
});

// ── resolveShapeColor ─────────────────────────────────────────────

describe('resolveShapeColor', () => {
  it('returns --color-brand for undefined', () => {
    expect(resolveShapeColor(undefined)).toBe('var(--color-brand)');
  });

  it('resolves ice-N to --brand-N', () => {
    expect(resolveShapeColor('ice-100')).toBe('var(--brand-100)');
    expect(resolveShapeColor('ice-300')).toBe('var(--brand-300)');
  });

  it('resolves brand to --color-brand', () => {
    expect(resolveShapeColor('brand')).toBe('var(--color-brand)');
  });

  it('resolves brand-N to --brand-N', () => {
    expect(resolveShapeColor('brand-400')).toBe('var(--brand-400)');
  });

  it('resolves slate-400 to --color-text-muted', () => {
    expect(resolveShapeColor('slate-400')).toBe('var(--color-text-muted)');
  });

  it('resolves other slate-N to --color-text-secondary', () => {
    expect(resolveShapeColor('slate-300')).toBe('var(--color-text-secondary)');
  });

  it('falls back to --color-brand for unknown token', () => {
    expect(resolveShapeColor('unknown-token')).toBe('var(--color-brand)');
  });
});

// ── runeGlyphMap ──────────────────────────────────────────────────

const ENTITY_KINDS: EntityKind[] = [
  'realm',
  'cluster',
  'host',
  'ravn_long',
  'ravn_raid',
  'skuld',
  'valkyrie',
  'tyr',
  'bifrost',
  'volundr',
  'mimir',
  'mimir_sub',
  'service',
  'model',
  'printer',
  'vaettir',
  'beacon',
  'raid',
];

const SYSTEM_COMPONENTS: SystemComponent[] = [
  'volundr',
  'tyr',
  'ravn',
  'mimir',
  'bifrost',
  'sleipnir',
  'buri',
  'hlidskjalf',
  'flokk',
  'skuld',
  'valkyrie',
];

const PERSONA_ROLES: PersonaRole[] = [
  'thought',
  'memory',
  'strength',
  'battle',
  'noise',
  'valkyrie',
];

describe('ENTITY_RUNES', () => {
  it('has a rune for every entity kind', () => {
    for (const kind of ENTITY_KINDS) {
      expect(ENTITY_RUNES[kind]).toBeTruthy();
    }
  });

  it('contains no forbidden runes', () => {
    for (const [kind, rune] of Object.entries(ENTITY_RUNES)) {
      expect(
        FORBIDDEN_RUNES.has(rune),
        `ENTITY_RUNES.${kind} = "${rune}" is a forbidden rune`,
      ).toBe(false);
    }
  });

  it('all rune values are single characters', () => {
    for (const rune of Object.values(ENTITY_RUNES)) {
      // Elder Futhark runes are in the supplementary plane; [...rune].length handles surrogates
      expect([...rune].length).toBe(1);
    }
  });
});

describe('SYSTEM_RUNES', () => {
  it('has a rune for every system component', () => {
    for (const component of SYSTEM_COMPONENTS) {
      expect(SYSTEM_RUNES[component]).toBeTruthy();
    }
  });

  it('contains no forbidden runes', () => {
    for (const [component, rune] of Object.entries(SYSTEM_RUNES)) {
      expect(
        FORBIDDEN_RUNES.has(rune),
        `SYSTEM_RUNES.${component} = "${rune}" is a forbidden rune`,
      ).toBe(false);
    }
  });
});

describe('PERSONA_RUNES', () => {
  it('has a rune for every persona role', () => {
    for (const role of PERSONA_ROLES) {
      expect(PERSONA_RUNES[role]).toBeTruthy();
    }
  });

  it('contains no forbidden runes', () => {
    for (const [role, rune] of Object.entries(PERSONA_RUNES)) {
      expect(
        FORBIDDEN_RUNES.has(rune),
        `PERSONA_RUNES.${role} = "${rune}" is a forbidden rune`,
      ).toBe(false);
    }
  });
});

describe('FORBIDDEN_RUNES', () => {
  it('contains exactly the ADL-flagged runes', () => {
    expect(FORBIDDEN_RUNES.has('ᛟ')).toBe(true); // Othala
    expect(FORBIDDEN_RUNES.has('ᛊ')).toBe(true); // Sowilo
    expect(FORBIDDEN_RUNES.has('ᛏ')).toBe(true); // Tiwaz
    expect(FORBIDDEN_RUNES.has('ᛉ')).toBe(true); // Algiz
    expect(FORBIDDEN_RUNES.has('ᚺ')).toBe(true); // Hagalaz
    expect(FORBIDDEN_RUNES.has('ᚻ')).toBe(true); // Hagalaz variant
  });
});
