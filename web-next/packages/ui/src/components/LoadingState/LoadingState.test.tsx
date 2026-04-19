import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('renders default title', () => {
    render(<LoadingState />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<LoadingState title="Fetching data…" />);
    expect(screen.getByText('Fetching data…')).toBeInTheDocument();
  });

  it('has status role with aria-live', () => {
    render(<LoadingState />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('renders description when provided', () => {
    render(<LoadingState description="This may take a moment." />);
    expect(screen.getByText('This may take a moment.')).toBeInTheDocument();
  });

  it('renders action slot when provided', () => {
    render(<LoadingState action={<button>Cancel</button>} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders spinner element', () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector('.niuu-loading-state__spinner')).toBeInTheDocument();
  });

  it('does not render description section when not provided', () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector('.niuu-loading-state__description')).not.toBeInTheDocument();
  });
});
