import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BranchTag } from './BranchTag';

describe('BranchTag', () => {
  it('renders source branch', () => {
    render(<BranchTag source="feat/my-feature" />);
    expect(screen.getByText('feat/my-feature')).toBeInTheDocument();
  });

  it('renders source and target with arrow', () => {
    render(<BranchTag source="feat/my-feature" target="main" />);
    expect(screen.getByText('feat/my-feature')).toBeInTheDocument();
    expect(screen.getByText('\u2190')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('does not render arrow when no target', () => {
    render(<BranchTag source="feat/my-feature" />);
    expect(screen.queryByText('\u2190')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<BranchTag source="main" className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
