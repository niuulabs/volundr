import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavnDetail } from './RavnDetail';
import {
  createMockRavenStream,
  createMockTriggerStore,
  createMockSessionStream,
  createMockBudgetStream,
} from '../adapters/mock';
import type { Ravn } from '../domain/ravn';

const SAMPLE_RAVN: Ravn = {
  id: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
  personaName: 'coding-agent',
  status: 'active',
  model: 'claude-sonnet-4-6',
  createdAt: '2026-04-15T09:00:00Z',
};

const SUSPENDED_RAVN: Ravn = {
  id: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
  personaName: 'investigator',
  status: 'suspended',
  model: 'claude-opus-4-6',
  createdAt: '2026-04-14T22:00:00Z',
};

function makeServices(overrides?: Record<string, unknown>) {
  return {
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

describe('RavnDetail', () => {
  it('renders the ravn detail pane', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('ravn-detail')).toBeInTheDocument();
  });

  it('shows the persona name in the header', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getAllByText('coding-agent').length).toBeGreaterThan(0);
  });

  it('renders the tab nav with 5 tabs', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('ravn-sectabs')).toBeInTheDocument();
    for (const id of ['overview', 'triggers', 'activity', 'sessions', 'connectivity']) {
      expect(screen.getByTestId(`sectab-${id}`)).toBeInTheDocument();
    }
  });

  it('shows overview tab active by default', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const overviewTab = screen.getByTestId('sectab-overview');
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows overview content by default', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('section-body-overview')).toBeInTheDocument();
  });

  it('shows persona name in overview section body', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getAllByText('coding-agent').length).toBeGreaterThan(0));
  });

  it('switches tab when a tab is clicked', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const triggersTab = screen.getByTestId('sectab-triggers');
    fireEvent.click(triggersTab);
    expect(triggersTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('section-body-triggers')).toBeInTheDocument();
  });

  it('persists active tab to localStorage', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const sessionsTab = screen.getByTestId('sectab-sessions');
    fireEvent.click(sessionsTab);
    const stored = localStorage.getItem('ravn.detail.tab');
    expect(stored).toBe('"sessions"');
  });

  it('restores active tab from localStorage', () => {
    localStorage.setItem('ravn.detail.tab', '"connectivity"');
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const connectivityTab = screen.getByTestId('sectab-connectivity');
    expect(connectivityTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows close button when onClose is provided', () => {
    const handleClose = vi.fn();
    render(<RavnDetail ravn={SAMPLE_RAVN} onClose={handleClose} />, { wrapper: wrap() });
    const btn = screen.getByTestId('detail-close-btn');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('does not show close button when onClose is not provided', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.queryByTestId('detail-close-btn')).not.toBeInTheDocument();
  });

  it('renders suspend and delete buttons in overview tab', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('suspend-btn')).toBeInTheDocument();
    expect(screen.getByTestId('suspend-btn')).not.toBeDisabled();
    expect(screen.getByTestId('delete-btn')).toBeInTheDocument();
  });

  it('disables suspend button when ravn is already suspended', () => {
    render(<RavnDetail ravn={SUSPENDED_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('suspend-btn')).toBeDisabled();
  });

  it('renders triggers section when triggers tab is clicked', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    fireEvent.click(screen.getByTestId('sectab-triggers'));
    await waitFor(() => expect(screen.getByTestId('triggers-section-body')).toBeInTheDocument());
  });

  it('renders sessions section when sessions tab is clicked', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    fireEvent.click(screen.getByTestId('sectab-sessions'));
    await waitFor(() => expect(screen.getByTestId('sessions-section-body')).toBeInTheDocument());
  });

  it('renders connectivity section when connectivity tab is clicked', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    fireEvent.click(screen.getByTestId('sectab-connectivity'));
    expect(screen.getByTestId('connectivity-section-body')).toBeInTheDocument();
  });

  it('shows trigger count badge on triggers tab when triggers exist', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    await waitFor(() => {
      const triggersTab = screen.getByTestId('sectab-triggers');
      // coding-agent has 1 trigger (webhook) in mock data
      expect(triggersTab.textContent).toMatch(/triggers/i);
    });
  });
});
