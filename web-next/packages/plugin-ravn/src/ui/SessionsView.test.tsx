import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SessionsView } from './SessionsView';
import { createMockSessionStream, createMockRavenStream } from '../adapters/mock';

function wrap(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

const services = {
  'ravn.sessions': createMockSessionStream(),
  'ravn.ravens': createMockRavenStream(),
};

describe('SessionsView', () => {
  it('shows loading state initially', () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('shows session list after loading', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText('coding-agent')).toBeInTheDocument());
  });

  it('shows session count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText('6')).toBeInTheDocument());
  });

  it('renders all sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByText('coding-agent')).toBeInTheDocument();
      expect(screen.getByText('reviewer')).toBeInTheDocument();
    });
  });

  it('loads transcript when session is selected', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText('coding-agent')).toBeInTheDocument());
    // First session should be auto-selected and transcript loaded
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('shows transcript message count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/messages/)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows error state when service fails', async () => {
    const failing = {
      listSessions: async () => {
        throw new Error('fetch failed');
      },
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': failing, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByText(/failed to load sessions/i)).toBeInTheDocument());
  });

  it('clicking a session item selects it', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(1),
    );
    const items = screen.getAllByRole('button', { name: /session/ });
    fireEvent.click(items[1]!);
    expect(items[1]).toHaveAttribute('aria-pressed', 'true');
  });
});
