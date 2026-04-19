import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { createMockTopologyStream } from '../adapters/mock';
import { makeCtxMock } from './TopologyCanvas/test-helpers';

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(makeCtxMock());
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(0));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('devicePixelRatio', 1);
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{ 'observatory.topology': createMockTopologyStream() }}
      >
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('ObservatoryPage', () => {
  it('renders the observatory page wrapper', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByTestId('observatory-page')).toBeInTheDocument();
  });

  it('renders the topology canvas', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByTestId('topology-canvas')).toBeInTheDocument();
  });

  it('renders camera controls', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByTestId('camera-controls')).toBeInTheDocument();
  });

  it('renders the minimap panel', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByTestId('minimap-panel')).toBeInTheDocument();
  });

  it('renders zoom controls', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
  });

  it('renders camera reset button', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByTestId('camera-reset')).toBeInTheDocument();
  });

  it('renders without crash when topology stream has no data yet', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nullStream = {
      getSnapshot: () => null,
      subscribe: (listener: (t: never) => void) => {
        void listener;
        return () => {};
      },
    };
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <ServicesProvider services={{ 'observatory.topology': nullStream }}>
            <ObservatoryPage />
          </ServicesProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });
});
