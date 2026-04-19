import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MountAccessRole } from './MountChip';
import { MountChip } from './MountChip';

const ALL_ROLES: MountAccessRole[] = ['primary', 'archive', 'ro'];

describe('MountChip', () => {
  it('renders the mount name', () => {
    render(<MountChip name="local-ops" role="primary" />);
    expect(screen.getByText('local-ops')).toBeInTheDocument();
  });

  it('renders abbreviated role label', () => {
    render(<MountChip name="shared-realm" role="archive" />);
    expect(screen.getByText('arch')).toBeInTheDocument();
  });

  it('renders "prim" for primary role', () => {
    render(<MountChip name="x" role="primary" />);
    expect(screen.getByText('prim')).toBeInTheDocument();
  });

  it('renders "ro" for read-only role', () => {
    render(<MountChip name="x" role="ro" />);
    expect(screen.getByText('ro')).toBeInTheDocument();
  });

  it('includes priority in title tooltip', () => {
    render(<MountChip name="ops" role="primary" priority={1} />);
    const chip = screen.getByTitle('ops (primary · p1)');
    expect(chip).toBeInTheDocument();
  });

  it('omits priority from title when not provided', () => {
    render(<MountChip name="ops" role="ro" />);
    const chip = screen.getByTitle('ops (ro)');
    expect(chip).toBeInTheDocument();
  });

  it('applies role modifier class', () => {
    render(<MountChip name="x" role="archive" />);
    const chip = screen.getByTitle('x (archive)');
    expect(chip).toHaveClass('niuu-mount-chip--archive');
  });

  it('applies custom className', () => {
    render(<MountChip name="x" role="primary" className="my-class" />);
    expect(screen.getByTitle('x (primary)')).toHaveClass('my-class');
  });

  it('renders all roles without throwing', () => {
    for (const role of ALL_ROLES) {
      expect(() => render(<MountChip name="mount" role={role} />)).not.toThrow();
    }
  });
});
