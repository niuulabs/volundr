import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('@/contexts/useAppIdentity', () => ({
  useAppIdentity: () => ({
    identity: null,
    isAdmin: false,
    hasRole: () => false,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/auth', () => ({
  useAuth: vi.fn(() => ({
    enabled: false,
    authenticated: false,
    loading: false,
    user: null,
    logout: vi.fn(),
  })),
}));

vi.mock('@/modules/shared/registry', () => ({
  getProductModules: vi.fn(() => []),
  getModuleDefinitions: vi.fn(() => []),
}));

function renderShell(children: React.ReactNode, isAdmin = false) {
  return render(
    <MemoryRouter>
      <AppShell isAdmin={isAdmin}>{children}</AppShell>
    </MemoryRouter>
  );
}

describe('AppShell', () => {
  it('renders children in main content area', () => {
    renderShell(<div data-testid="page-content">Hello</div>);

    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders the sidebar', () => {
    renderShell(<div>Content</div>);

    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
  });

  it('passes isAdmin to sidebar', () => {
    renderShell(<div>Content</div>, true);

    const adminLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Admin');
    expect(adminLink).toBeDefined();
  });

  it('does not show admin when isAdmin is false', () => {
    renderShell(<div>Content</div>, false);

    const adminLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Admin');
    expect(adminLink).toBeUndefined();
  });
});
