import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminGuard } from './AdminGuard';
import type { IVolundrService } from '@/ports';

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: vi.fn(),
}));

import { useIdentity } from '@/hooks/useIdentity';

const mockService = {} as IVolundrService;

describe('AdminGuard', () => {
  it('shows loading state', () => {
    vi.mocked(useIdentity).mockReturnValue({
      identity: null,
      isAdmin: false,
      loading: true,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard service={mockService}>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('redirects non-admin users', () => {
    vi.mocked(useIdentity).mockReturnValue({
      identity: null,
      isAdmin: false,
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard service={mockService}>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('renders children for admin users', () => {
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'u-1',
        email: 'admin@test.com',
        tenantId: 't-1',
        roles: ['volundr:admin'],
        displayName: 'Admin',
        status: 'active',
      },
      isAdmin: true,
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <AdminGuard service={mockService}>
          <div>Protected</div>
        </AdminGuard>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected')).toBeInTheDocument();
  });
});
