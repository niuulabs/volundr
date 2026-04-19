import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CallbackPage } from './CallbackPage';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@niuulabs/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(),
}));

import { useAuth } from '@niuulabs/auth';
import { useNavigate } from '@tanstack/react-router';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CallbackPage', () => {
  const mockNavigate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
  });

  it('renders the page root', () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: true,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(<CallbackPage />);
    expect(screen.getByTestId('callback-page')).toBeInTheDocument();
  });

  it('shows "Completing sign-in…" and a spinner while loading', () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: true,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(<CallbackPage />);
    expect(screen.getByText('Completing sign-in…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows "Redirecting…" once authenticated and loading is false', () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: false,
      authenticated: true,
      enabled: true,
      user: { sub: 'u1', accessToken: 'tok', expired: false },
      accessToken: 'tok',
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(<CallbackPage />);
    expect(screen.getByText('Redirecting…')).toBeInTheDocument();
  });

  it('navigates to "/" when not loading and authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: false,
      authenticated: true,
      enabled: true,
      user: { sub: 'u1', accessToken: 'tok', expired: false },
      accessToken: 'tok',
      login: vi.fn(),
      logout: vi.fn(),
    });
    await act(async () => {
      render(<CallbackPage />);
    });
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('does not navigate while loading', async () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: true,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    await act(async () => {
      render(<CallbackPage />);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows "Sign-in failed." when not loading and not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: false,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(<CallbackPage />);
    expect(screen.getByText('Sign-in failed.')).toBeInTheDocument();
    // No spinner shown in failed state
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not navigate when not authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: false,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    await act(async () => {
      render(<CallbackPage />);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
