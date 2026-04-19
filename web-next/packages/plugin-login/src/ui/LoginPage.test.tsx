import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';

// ---------------------------------------------------------------------------
// Canvas mock — jsdom doesn't implement canvas
// ---------------------------------------------------------------------------

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  it('renders the niuu wordmark', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.getByText('iuu')).toBeInTheDocument(); // wordmark has <strong>n</strong>iuu
  });

  it('renders the Sign in button', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByTestId('sign-in-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls onLogin when the Sign in button is clicked', async () => {
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sign-in-button'));
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('renders a spinner and disables the button when loading=true', () => {
    render(<LoginPage onLogin={vi.fn()} loading />);
    const btn = screen.getByTestId('sign-in-button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    // Spinner has aria-label
    expect(screen.getByLabelText('Signing in…')).toBeInTheDocument();
    // The "Sign in" text should not appear when loading
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('renders an error message when error is provided', () => {
    render(<LoginPage onLogin={vi.fn()} error="OIDC provider unavailable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('OIDC provider unavailable');
    expect(screen.getByTestId('login-error')).toBeInTheDocument();
  });

  it('does not render error message when error is null', () => {
    render(<LoginPage onLogin={vi.fn()} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render error message by default', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByText('agentic infrastructure, braided')).toBeInTheDocument();
  });

  it('renders the sign in divider', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByText('sign in')).toBeInTheDocument();
  });

  it('does not call onLogin when button is disabled (loading)', async () => {
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} loading />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('sign-in-button'));
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('renders the ambient canvas element', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    // Canvas is aria-hidden but present in DOM
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute('aria-hidden');
  });
});
