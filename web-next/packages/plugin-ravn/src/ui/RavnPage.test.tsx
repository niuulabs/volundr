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

describe('RavnPage (PersonasPage)', () => {
  it('renders the ravn personas page', async () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByTestId('personas-page')).toBeInTheDocument();
  });

  it('shows the ravn rune glyph', () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getAllByText('ᚱ')[0]).toBeInTheDocument();
  });

  it('shows ravn subtitle text', () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByText(/ravn · personas · ravens · sessions/)).toBeInTheDocument();
  });

  it('loads and displays personas list', async () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());
  });

  it('shows empty state before a persona is selected', () => {
    render(<RavnPage />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    expect(screen.getByTestId('personas-empty-state')).toBeInTheDocument();
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
