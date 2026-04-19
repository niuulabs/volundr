import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { createMockTopologyStream, createMockEventStream } from '../adapters/mock';

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{
          'observatory.topology': createMockTopologyStream(),
          'observatory.events': createMockEventStream(),
        }}
      >
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('ObservatoryPage', () => {
  it('renders the Observatory title and subtitle', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText('Observatory')).toBeInTheDocument();
    expect(screen.getByText(/live topology/)).toBeInTheDocument();
  });

  it('displays node and edge counts from the topology snapshot', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText('nodes')).toBeInTheDocument();
    expect(screen.getByText('edges')).toBeInTheDocument();
  });

  it('renders recent events from the event stream', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByText('Recent events')).toBeInTheDocument();
    expect(screen.getAllByText(/huginn/).length).toBeGreaterThan(0);
  });

  it('shows connecting state when topology is null', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nullTopologyStream = {
      getSnapshot: () => null,
      subscribe: (listener: (t: never) => void) => {
        void listener;
        return () => {};
      },
    };
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider
          services={{
            'observatory.topology': nullTopologyStream,
            'observatory.events': createMockEventStream(),
          }}
        >
          <ObservatoryPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('connecting…')).toBeInTheDocument();
  });
});
