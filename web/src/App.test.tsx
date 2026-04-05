import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

vi.mock('@/modules/volundr/pages/Volundr', () => ({
  VolundrPage: () => <div data-testid="volundr-page">Volundr Page</div>,
}));

vi.mock('@/modules/volundr/pages/Volundr/VolundrPopout', () => ({
  VolundrPopout: () => <div data-testid="volundr-popout">Volundr Popout</div>,
}));

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

import { VolundrPage } from '@/modules/volundr/pages/Volundr';
import { VolundrPopout } from '@/modules/volundr/pages/Volundr/VolundrPopout';
import { AppShell } from '@/modules/shared/components/AppShell';

function TestApp({ initialRoute = '/' }: { initialRoute?: string }) {
  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/volundr/popout" element={<VolundrPopout />} />
        <Route path="/popout" element={<VolundrPopout />} />
        <Route
          path="/*"
          element={
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/volundr" replace />} />
                <Route path="/volundr" element={<VolundrPage />} />
              </Routes>
            </AppShell>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('App', () => {
  it('redirects / to /volundr', () => {
    render(<TestApp />);
    expect(screen.getByTestId('volundr-page')).toBeInTheDocument();
  });

  it('renders Volundr page at /volundr', () => {
    render(<TestApp initialRoute="/volundr" />);
    expect(screen.getByTestId('volundr-page')).toBeInTheDocument();
  });

  it('renders popout at /volundr/popout without shell', () => {
    render(<TestApp initialRoute="/volundr/popout" />);
    expect(screen.getByTestId('volundr-popout')).toBeInTheDocument();
    expect(screen.queryByLabelText('Main navigation')).not.toBeInTheDocument();
  });

  it('renders popout at /popout without shell', () => {
    render(<TestApp initialRoute="/popout" />);
    expect(screen.getByTestId('volundr-popout')).toBeInTheDocument();
    expect(screen.queryByLabelText('Main navigation')).not.toBeInTheDocument();
  });

  it('renders sidebar on non-popout routes', () => {
    render(<TestApp initialRoute="/volundr" />);
    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
  });
});
