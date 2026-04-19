import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adjusting your filters." />);
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">📭</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders action slot when provided', () => {
    render(<EmptyState title="Empty" action={<button>Create first</button>} />);
    expect(screen.getByRole('button', { name: 'Create first' })).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.niuu-empty-state__description')).not.toBeInTheDocument();
  });

  it('does not render action when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.niuu-empty-state__action')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Empty" className="custom" />);
    expect(container.querySelector('.custom')).toBeInTheDocument();
  });
});
