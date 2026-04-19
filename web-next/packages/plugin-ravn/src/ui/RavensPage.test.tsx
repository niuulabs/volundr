import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavensPage } from './RavensPage';
import {
  createMockRavenStream,
  createMockBudgetStream,
  createMockTriggerStore,
  createMockSessionStream,
} from '../adapters/mock';

function makeServices(overrides?: Record<string, unknown>) {
  return {
    'ravn.ravens': createMockRavenStream(),
    'ravn.budget': createMockBudgetStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.sessions': createMockSessionStream(),
    ...overrides,
  };
}

function wrap(services = makeServices()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('RavensPage', () => {
  it('shows loading state initially', () => {
    const slow = { listRavens: () => new Promise(() => undefined) };
    render(<RavensPage />, { wrapper: wrap(makeServices({ 'ravn.ravens': slow })) });
    expect(screen.getByTestId('ravens-loading')).toBeInTheDocument();
  });

  it('renders ravens page after loading', async () => {
    render(<RavensPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('ravens-page')).toBeInTheDocument());
  });

  it('shows error state when ravens service fails', async () => {
    const failing = { listRavens: () => Promise.reject(new Error('load failed')) };
    render(<RavensPage />, { wrapper: wrap(makeServices({ 'ravn.ravens': failing })) });
    await waitFor(() => expect(screen.getByTestId('ravens-error')).toBeInTheDocument());
    expect(screen.getByText(/load failed/i)).toBeInTheDocument();
  });

  it('renders the layout selector', async () => {
    render(<RavensPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('layout-selector')).toBeInTheDocument());
  });

  it('renders the grouping selector', async () => {
    render(<RavensPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('grouping-selector')).toBeInTheDocument());
  });

  describe('layout switching', () => {
    it('defaults to split layout', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => expect(screen.getByTestId('layout-split')).toBeInTheDocument());
    });

    it('switches to table layout', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-table'));
      fireEvent.click(screen.getByTestId('layout-btn-table'));
      expect(screen.getByTestId('layout-table')).toBeInTheDocument();
      expect(screen.queryByTestId('layout-split')).not.toBeInTheDocument();
    });

    it('switches to cards layout', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-cards'));
      fireEvent.click(screen.getByTestId('layout-btn-cards'));
      expect(screen.getByTestId('layout-cards')).toBeInTheDocument();
    });

    it('switches back to split layout from cards', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-cards'));
      fireEvent.click(screen.getByTestId('layout-btn-cards'));
      fireEvent.click(screen.getByTestId('layout-btn-split'));
      expect(screen.getByTestId('layout-split')).toBeInTheDocument();
    });

    it('persists layout selection to localStorage', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-table'));
      fireEvent.click(screen.getByTestId('layout-btn-table'));
      expect(localStorage.getItem('ravn.ravens.layout')).toBe('"table"');
    });
  });

  describe('grouping', () => {
    it('groups by state when selected', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('grouping-selector'));
      const selector = screen.getByTestId('grouping-selector');
      fireEvent.change(selector, { target: { value: 'state' } });

      // Should show group headers for each state
      await waitFor(() => {
        const headers = screen.queryAllByText(/^active$/i);
        return headers.length > 0;
      });
      expect(localStorage.getItem('ravn.ravens.group')).toBe('"state"');
    });

    it('groups by persona when selected', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('grouping-selector'));
      const selector = screen.getByTestId('grouping-selector');
      fireEvent.change(selector, { target: { value: 'persona' } });
      expect(localStorage.getItem('ravn.ravens.group')).toBe('"persona"');
    });

    it('groups by location when selected', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('grouping-selector'));
      const selector = screen.getByTestId('grouping-selector');
      fireEvent.change(selector, { target: { value: 'location' } });
      expect(localStorage.getItem('ravn.ravens.group')).toBe('"location"');
    });
  });

  describe('ravn selection in split view', () => {
    it('shows empty state when no ravn is selected', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => expect(screen.getByTestId('detail-empty')).toBeInTheDocument());
    });

    it('shows ravn detail when a ravn is selected', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getAllByTestId('ravn-list-row'));
      const rows = screen.getAllByTestId('ravn-list-row');
      fireEvent.click(rows[0]!);
      await waitFor(() => expect(screen.getByTestId('ravn-detail')).toBeInTheDocument());
    });

    it('deselects ravn when same row is clicked again', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getAllByTestId('ravn-list-row'));
      const rows = screen.getAllByTestId('ravn-list-row');
      fireEvent.click(rows[0]!);
      await waitFor(() => expect(screen.getByTestId('ravn-detail')).toBeInTheDocument());
      fireEvent.click(rows[0]!);
      await waitFor(() => expect(screen.queryByTestId('ravn-detail')).not.toBeInTheDocument());
    });

    it('closes detail pane when close button is clicked', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getAllByTestId('ravn-list-row'));
      fireEvent.click(screen.getAllByTestId('ravn-list-row')[0]!);
      await waitFor(() => expect(screen.getByTestId('detail-close-btn')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('detail-close-btn'));
      await waitFor(() => expect(screen.queryByTestId('ravn-detail')).not.toBeInTheDocument());
    });
  });

  describe('table layout', () => {
    it('renders table rows', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-table'));
      fireEvent.click(screen.getByTestId('layout-btn-table'));
      await waitFor(() => screen.getAllByTestId('ravn-table-row'));
      expect(screen.getAllByTestId('ravn-table-row').length).toBeGreaterThan(0);
    });
  });

  describe('cards layout', () => {
    it('renders ravn cards', async () => {
      render(<RavensPage />, { wrapper: wrap() });
      await waitFor(() => screen.getByTestId('layout-btn-cards'));
      fireEvent.click(screen.getByTestId('layout-btn-cards'));
      await waitFor(() => screen.getAllByTestId('ravn-card'));
      expect(screen.getAllByTestId('ravn-card').length).toBeGreaterThan(0);
    });
  });
});
