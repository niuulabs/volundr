import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavnPage } from './RavnPage';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockTriggerStore,
  createMockSessionStream,
  createMockBudgetStream,
} from '../adapters/mock';

function makeServices(overrides?: Record<string, unknown>) {
  return {
    'ravn.personas': createMockPersonaStore(),
    'ravn.ravens': createMockRavenStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.budget': createMockBudgetStream(),
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

describe('RavnPage', () => {
  it('renders the ravn page wrapper', () => {
    render(<RavnPage />, { wrapper: wrap() });
    expect(screen.getByTestId('ravn-page')).toBeInTheDocument();
  });

  it('renders the ravn rune glyph', () => {
    render(<RavnPage />, { wrapper: wrap() });
    expect(screen.getByText('ᚱ')).toBeInTheDocument();
  });

  it('renders the page title', () => {
    render(<RavnPage />, { wrapper: wrap() });
    expect(screen.getByText(/Ravn · the flock/)).toBeInTheDocument();
  });

  it('renders the tab navigation', () => {
    render(<RavnPage />, { wrapper: wrap() });
    expect(screen.getByTestId('ravn-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('ravn-tab-ravens')).toBeInTheDocument();
    expect(screen.getByTestId('ravn-tab-personas')).toBeInTheDocument();
  });

  it('defaults to the overview tab', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });

  it('switches to the ravens tab', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    await waitFor(() => expect(screen.getByTestId('ravens-page')).toBeInTheDocument());
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('switches back to overview tab', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    await waitFor(() => screen.getByTestId('ravens-page'));
    fireEvent.click(screen.getByTestId('ravn-tab-overview'));
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });

  it('persists active tab to localStorage', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    expect(localStorage.getItem('ravn.tab')).toBe('"ravens"');
  });

  it('restores tab from localStorage on mount', async () => {
    localStorage.setItem('ravn.tab', '"ravens"');
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('ravens-page')).toBeInTheDocument());
  });
});

describe('RavnPage — Personas tab', () => {
  it('switches to the personas tab', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => screen.getByTestId('ravn-tab-personas'));
    fireEvent.click(screen.getByTestId('ravn-tab-personas'));
    await waitFor(() => expect(screen.getByTestId('personas-page')).toBeInTheDocument());
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('shows the persona list after switching to personas tab', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    fireEvent.click(screen.getByTestId('ravn-tab-personas'));
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());
  });

  it('persists personas tab to localStorage', async () => {
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => screen.getByTestId('ravn-tab-personas'));
    fireEvent.click(screen.getByTestId('ravn-tab-personas'));
    expect(localStorage.getItem('ravn.tab')).toBe('"personas"');
  });

  it('restores personas tab from localStorage on mount', async () => {
    localStorage.setItem('ravn.tab', '"personas"');
    render(<RavnPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('personas-page')).toBeInTheDocument());
  });
});
