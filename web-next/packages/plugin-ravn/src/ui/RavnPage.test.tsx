import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavnPage } from './RavnPage';
import { createMockPersonaStore } from '../adapters/mock';

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

describe('RavnPage', () => {
  it('renders the page title', async () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByText(/ravn/)).toBeInTheDocument();
  });

  it('shows loading state then persona count', async () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByText(/loading/).or ? screen.queryByText(/loading/) : null);
    await waitFor(() => expect(screen.getByText(/21 personas loaded/)).toBeInTheDocument());
  });

  it('renders the Ravn rune glyph', async () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByText('ᚱ')).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failing = {
      listPersonas: async () => {
        throw new Error('fetch failed');
      },
    };
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': failing }),
    });
    await waitFor(() => expect(screen.getByText('fetch failed')).toBeInTheDocument());
  });
});
