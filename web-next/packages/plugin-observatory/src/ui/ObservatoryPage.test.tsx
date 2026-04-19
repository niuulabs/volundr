import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { createMockRegistryRepository } from '../adapters/mock';

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ 'observatory.registry': createMockRegistryRepository() }}>
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('ObservatoryPage', () => {
  it('renders the title', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText('Flokk · Observatory')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText(/Live topology view/)).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText(/loading registry/)).toBeInTheDocument();
  });

  it('shows entity type count after data loads', async () => {
    wrap(<ObservatoryPage />);
    await waitFor(() => expect(screen.getByText('entity types')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('registry version')).toBeInTheDocument();
  });

  it('renders placeholder note', async () => {
    wrap(<ObservatoryPage />);
    await waitFor(() => expect(screen.getByText(/Canvas and registry editor/)).toBeInTheDocument());
  });

  it('shows error state when the registry service throws', async () => {
    const failing: ReturnType<typeof createMockRegistryRepository> = {
      loadRegistry: async () => {
        throw new Error('registry unavailable');
      },
      saveRegistry: async () => {},
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider services={{ 'observatory.registry': failing }}>
          <ObservatoryPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('registry unavailable')).toBeInTheDocument());
  });
});
