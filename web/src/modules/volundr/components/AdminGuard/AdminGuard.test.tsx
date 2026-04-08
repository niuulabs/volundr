import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminGuard } from './AdminGuard';

vi.mock('@/contexts/useAppIdentity', () => ({
  useAppIdentity: vi.fn(),
}));

import { useAppIdentity } from '@/contexts/useAppIdentity';

describe('AdminGuard', () => {
  it('shows loading state', () => {
    vi.mocked(useAppIdentity).mockReturnValue({
      identity: null,
      isAdmin: false,
      hasRole: () => false,
      loading: true,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('redirects non-admin users', () => {
    vi.mocked(useAppIdentity).mockReturnValue({
      identity: null,
      isAdmin: false,
      hasRole: () => false,
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('renders children for admin users', () => {
    vi.mocked(useAppIdentity).mockReturnValue({
      identity: {
        userId: 'u-1',
        email: 'admin@test.com',
        tenantId: 't-1',
        roles: ['volundr:admin'],
        displayName: 'Admin',
        status: 'active',
      },
      isAdmin: true,
      hasRole: () => false,
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected')).toBeInTheDocument();
  });
});
