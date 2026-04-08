import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortsProvider } from '@/contexts/PortsContext';
import type { PortsContextValue, InstancePorts } from '@/contexts/PortsContext';
import { BrowserPage } from './BrowserPage';
import type { MimirPageMeta } from '@/domain';

const mockPages: MimirPageMeta[] = [
  {
    path: 'technical/ravn/architecture.md',
    title: 'Ravn Architecture',
    summary: 'Overview',
    category: 'technical',
    updatedAt: '2026-04-08T12:00:00Z',
    sourceIds: ['src_abc'],
  },
  {
    path: 'projects/niuu/roadmap.md',
    title: 'Niuu Roadmap',
    summary: 'Roadmap',
    category: 'projects',
    updatedAt: '2026-04-08T12:00:00Z',
    sourceIds: [],
  },
];

function makePorts(overrides: Partial<InstancePorts['api']> = {}): InstancePorts {
  return {
    instance: { name: 'local', url: 'http://localhost/mimir', role: 'local', writeEnabled: true },
    api: {
      getStats: vi.fn().mockResolvedValue({ pageCount: 2, categories: ['technical'], healthy: true }),
      listPages: vi.fn().mockResolvedValue(mockPages),
      getPage: vi.fn().mockResolvedValue({
        path: 'technical/ravn/architecture.md',
        title: 'Ravn Architecture',
        summary: 'Overview',
        category: 'technical',
        updatedAt: '2026-04-08T12:00:00Z',
        sourceIds: [],
        content: '# Ravn Architecture\n\nContent.',
      }),
      search: vi.fn().mockResolvedValue([]),
      getLog: vi.fn(),
      getLint: vi.fn(),
      upsertPage: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    ingest: { ingest: vi.fn() },
    graph: { getGraph: vi.fn() },
    events: { subscribe: vi.fn().mockReturnValue(() => {}), isConnected: vi.fn().mockReturnValue(false) },
  };
}

function renderBrowserPage(ports: InstancePorts, initialPath = '/browse') {
  const value: PortsContextValue = {
    instances: [ports],
    activeInstanceName: 'local',
    setActiveInstanceName: vi.fn(),
  };
  return render(
    <PortsProvider value={value}>
      <MemoryRouter initialEntries={[initialPath]}>
        <BrowserPage />
      </MemoryRouter>
    </PortsProvider>,
  );
}

describe('BrowserPage', () => {
  it('renders the page structure', () => {
    const ports = makePorts();
    const { container } = renderBrowserPage(ports);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows search input', () => {
    const ports = makePorts();
    renderBrowserPage(ports);
    expect(screen.getByRole('searchbox', { name: /search pages/i })).toBeDefined();
  });

  it('calls listPages on mount', async () => {
    const ports = makePorts();
    renderBrowserPage(ports);
    await waitFor(() => {
      expect(ports.api.listPages).toHaveBeenCalled();
    });
  });

  it('shows page tree after loading', async () => {
    const ports = makePorts();
    renderBrowserPage(ports);
    await waitFor(() => {
      expect(screen.getByText('Ravn Architecture')).toBeDefined();
    });
  });

  it('shows "No page selected" when no path in URL', () => {
    const ports = makePorts();
    renderBrowserPage(ports, '/browse');
    expect(screen.getByText('No page selected')).toBeDefined();
  });

  it('shows empty state message when no page selected', () => {
    const ports = makePorts();
    renderBrowserPage(ports, '/browse');
    expect(screen.getByText(/Select a page from the tree/i)).toBeDefined();
  });

  it('updates search query on input change', () => {
    const ports = makePorts();
    renderBrowserPage(ports);
    const searchInput = screen.getByRole('searchbox', { name: /search pages/i });
    fireEvent.change(searchInput, { target: { value: 'ravn' } });
    expect((searchInput as HTMLInputElement).value).toBe('ravn');
  });

  it('shows View/Edit toggle button when page is selected', async () => {
    const ports = makePorts();
    renderBrowserPage(ports, '/browse?path=technical/ravn/architecture.md');
    await waitFor(() => {
      expect(screen.getByText('Ravn Architecture')).toBeDefined();
    });
    // Edit/View button should appear when a path is selected
    const toggleBtn = screen.queryByRole('button', { name: /edit|view/i });
    expect(toggleBtn).not.toBeNull();
  });
});
