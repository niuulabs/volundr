import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders title', () => {
    render(<ErrorState title="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('has alert role', () => {
    render(<ErrorState title="Error" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders default icon when none provided', () => {
    const { container } = render(<ErrorState title="Error" />);
    expect(container.querySelector('.niuu-error-state__icon')).toBeInTheDocument();
  });

  it('renders custom icon', () => {
    render(<ErrorState title="Error" icon={<span data-testid="custom-icon">!</span>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders description as code-styled text', () => {
    render(<ErrorState title="Error" description="Connection refused: 503" />);
    expect(screen.getByText('Connection refused: 503')).toBeInTheDocument();
  });

  it('renders action slot', () => {
    render(<ErrorState title="Error" action={<button>Retry</button>} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<ErrorState title="Error" />);
    expect(container.querySelector('.niuu-error-state__description')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ErrorState title="Error" className="custom" />);
    expect(container.querySelector('.custom')).toBeInTheDocument();
  });
});
