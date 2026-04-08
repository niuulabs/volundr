import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hammer, Swords } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { getModuleDefinitions } from '@/modules/shared/registry';

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

vi.mock('@/modules/shared/registry', () => {
  const modules: Array<{
    key: string;
    label: string;
    icon: React.ComponentType;
    basePath: string;
    routes: Array<unknown>;
    load: () => Promise<{ default: React.ComponentType }>;
  }> = [];

  return {
    registerProductModule: vi.fn((entry: (typeof modules)[0]) => modules.push(entry)),
    getProductModules: vi.fn(() => [...modules]),
    getModuleDefinitions: vi.fn(() => [...modules]),
  };
});

function renderSidebar(route = '/', isAdmin = false) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar isAdmin={isAdmin} />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getModuleDefinitions as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        key: 'volundr',
        label: 'Völundr',
        icon: Hammer,
        basePath: '/volundr',
        routes: [],
        load: vi.fn(),
      },
    ]);
  });

  it('renders product module icons', () => {
    renderSidebar('/volundr');

    const links = screen.getAllByRole('link');
    const volundrLink = links.find(l => l.getAttribute('data-tooltip') === 'Völundr');
    expect(volundrLink).toBeDefined();
  });

  it('renders settings icon', () => {
    renderSidebar();

    const settingsLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Settings');
    expect(settingsLink).toBeDefined();
  });

  it('renders admin icon when isAdmin is true', () => {
    renderSidebar('/', true);

    const adminLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Admin');
    expect(adminLink).toBeDefined();
  });

  it('does not render admin icon when isAdmin is false', () => {
    renderSidebar('/', false);

    const adminLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Admin');
    expect(adminLink).toBeUndefined();
  });

  it('highlights active product module', () => {
    renderSidebar('/volundr');

    const links = screen.getAllByRole('link');
    const volundrLink = links.find(l => l.getAttribute('data-tooltip') === 'Völundr');
    expect(volundrLink?.className).toContain('navItemActive');
  });

  it('highlights settings when on settings page', () => {
    renderSidebar('/settings');

    const settingsLink = screen
      .getAllByRole('link')
      .find(l => l.getAttribute('data-tooltip') === 'Settings');
    expect(settingsLink?.className).toContain('navItemActive');
  });

  it('renders multiple product modules', () => {
    (getModuleDefinitions as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        key: 'volundr',
        label: 'Völundr',
        icon: Hammer,
        basePath: '/volundr',
        routes: [],
        load: vi.fn(),
      },
      { key: 'tyr', label: 'Tyr', icon: Swords, basePath: '/tyr', routes: [], load: vi.fn() },
    ]);

    renderSidebar('/volundr');

    const links = screen.getAllByRole('link');
    expect(links.find(l => l.getAttribute('data-tooltip') === 'Völundr')).toBeDefined();
    expect(links.find(l => l.getAttribute('data-tooltip') === 'Tyr')).toBeDefined();
  });

  it('links to correct paths', () => {
    renderSidebar('/volundr');

    const links = screen.getAllByRole('link');
    const volundrLink = links.find(l => l.getAttribute('data-tooltip') === 'Völundr');
    expect(volundrLink).toHaveAttribute('href', '/volundr');

    const settingsLink = links.find(l => l.getAttribute('data-tooltip') === 'Settings');
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  it('has main navigation aria label', () => {
    renderSidebar();

    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
  });

  it('hides modules when user lacks required role', () => {
    (getModuleDefinitions as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        key: 'restricted',
        label: 'Restricted',
        icon: Hammer,
        basePath: '/restricted',
        requiredRoles: ['admin'],
        routes: [],
        load: vi.fn(),
      },
    ]);

    renderSidebar();

    const links = screen.getAllByRole('link');
    expect(links.find(l => l.getAttribute('data-tooltip') === 'Restricted')).toBeUndefined();
  });
});
