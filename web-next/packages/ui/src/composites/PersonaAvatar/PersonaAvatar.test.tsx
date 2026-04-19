import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaRole } from '@niuulabs/domain';
import { PersonaAvatar } from './PersonaAvatar';
import { ROLE_SHAPE_MAP } from '../PersonaShape/PersonaShape';

const ALL_ROLES: PersonaRole[] = [
  'plan',
  'build',
  'verify',
  'review',
  'gate',
  'audit',
  'ship',
  'index',
  'report',
];

describe('PersonaAvatar', () => {
  it('renders with role img', () => {
    render(<PersonaAvatar role="build" letter="B" />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('shows the letter', () => {
    render(<PersonaAvatar role="plan" letter="P" />);
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('uppercases the first character of letter', () => {
    render(<PersonaAvatar role="audit" letter="a" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('uses only the first character of multi-char letter strings', () => {
    render(<PersonaAvatar role="report" letter="Rp" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('uses role as fallback for aria-label', () => {
    render(<PersonaAvatar role="gate" letter="G" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'gate');
  });

  it('uses title prop for aria-label when provided', () => {
    render(<PersonaAvatar role="gate" letter="G" title="Gatekeeper" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Gatekeeper');
  });

  it('applies custom className', () => {
    render(<PersonaAvatar role="ship" letter="S" className="my-class" />);
    expect(screen.getByRole('img')).toHaveClass('my-class');
  });
});

describe('ROLE_SHAPE_MAP determinism', () => {
  it('maps every role to the same shape on repeated calls', () => {
    for (const role of ALL_ROLES) {
      const shape1 = ROLE_SHAPE_MAP[role];
      const shape2 = ROLE_SHAPE_MAP[role];
      expect(shape1).toBe(shape2);
    }
  });

  it('maps all nine roles to distinct shapes', () => {
    const shapes = ALL_ROLES.map((r) => ROLE_SHAPE_MAP[r]);
    const unique = new Set(shapes);
    expect(unique.size).toBe(ALL_ROLES.length);
  });

  it('maps plan → triangle', () => expect(ROLE_SHAPE_MAP['plan']).toBe('triangle'));
  it('maps build → square', () => expect(ROLE_SHAPE_MAP['build']).toBe('square'));
  it('maps verify → ring', () => expect(ROLE_SHAPE_MAP['verify']).toBe('ring'));
  it('maps review → halo', () => expect(ROLE_SHAPE_MAP['review']).toBe('halo'));
  it('maps gate → hex', () => expect(ROLE_SHAPE_MAP['gate']).toBe('hex'));
  it('maps audit → chevron', () => expect(ROLE_SHAPE_MAP['audit']).toBe('chevron'));
  it('maps ship → ring-dashed', () => expect(ROLE_SHAPE_MAP['ship']).toBe('ring-dashed'));
  it('maps index → mimir-small', () => expect(ROLE_SHAPE_MAP['index']).toBe('mimir-small'));
  it('maps report → pentagon', () => expect(ROLE_SHAPE_MAP['report']).toBe('pentagon'));

  it('renders PersonaAvatar for every role without throwing', () => {
    for (const role of ALL_ROLES) {
      expect(() =>
        render(<PersonaAvatar role={role} letter={role[0]!.toUpperCase()} />),
      ).not.toThrow();
    }
  });
});
