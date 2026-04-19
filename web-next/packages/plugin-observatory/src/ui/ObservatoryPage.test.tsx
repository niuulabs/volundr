import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { createMockRegistryRepository, createMockLiveTopologyStream } from '../adapters/mock';

// ── Mock browser APIs (needed by TopologyCanvas) ──────────────────────────────

function makeMockCtx(): Partial<CanvasRenderingContext2D> {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    createRadialGradient: vi.fn().mockReturnValue(gradient),
    createLinearGradient: vi.fn().mockReturnValue(gradient),
  };
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(makeMockCtx());

  global.ResizeObserver = vi.fn().mockImplementation((cb) => ({
    observe: vi.fn(() =>
      cb([{ contentRect: { width: 800, height: 600 } }], null as unknown as ResizeObserver),
    ),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));

  vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('performance', { now: () => 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{
          'observatory.registry': createMockRegistryRepository(),
          'observatory.topology': createMockLiveTopologyStream(),
        }}
      >
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

  it('renders the topology canvas element', () => {
    wrap(<ObservatoryPage />);
    expect(document.querySelector('canvas')).toBeTruthy();
  });

  it('shows the minimap', () => {
    wrap(<ObservatoryPage />);
    expect(screen.getByLabelText('Topology minimap')).toBeInTheDocument();
  });

  it('shows registry version after registry loads', async () => {
    wrap(<ObservatoryPage />);
    await waitFor(() => expect(screen.getByText(/types · v\d+/)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows entity count in minimap caption once topology loads', async () => {
    wrap(<ObservatoryPage />);
    // The mock stream emits immediately, so entities > 0 quickly.
    await waitFor(
      () => {
        const text = screen.getByText(/\d+ entities/);
        const count = parseInt(text.textContent ?? '0');
        expect(count).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });

  it('does not crash when registry service throws', async () => {
    const failing = {
      loadRegistry: async () => {
        throw new Error('registry unavailable');
      },
      saveRegistry: async () => {},
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider
          services={{
            'observatory.registry': failing,
            'observatory.topology': createMockLiveTopologyStream(),
          }}
        >
          <ObservatoryPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    // The page still renders (no full crash) — registry error is non-fatal.
    expect(screen.getByText('Flokk · Observatory')).toBeInTheDocument();
  });
});
