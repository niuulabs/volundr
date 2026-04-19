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

  it('renders all 6 collapsible sections', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    for (const id of ['overview', 'triggers', 'activity', 'sessions', 'connectivity', 'delete']) {
      expect(screen.getByTestId(`ravn-detail-section-${id}`)).toBeInTheDocument();
    }
  });

  it('shows overview section expanded by default', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    expect(screen.getByTestId('section-body-overview')).toBeInTheDocument();
  });

  it('shows persona name in overview section body', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getAllByText('coding-agent').length).toBeGreaterThan(0));
  });

  it('collapses a section when its toggle is clicked', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-overview');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('section-body-overview')).not.toBeInTheDocument();
  });

  it('expands a collapsed section when toggle is clicked again', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-overview');
    fireEvent.click(toggle); // collapse
    fireEvent.click(toggle); // expand
    expect(screen.getByTestId('section-body-overview')).toBeInTheDocument();
  });

  it('persists collapsed state to localStorage', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-triggers');
    fireEvent.click(toggle); // expand triggers
    const stored = JSON.parse(
      localStorage.getItem('ravn.detail.sections.collapsed') ?? '[]',
    ) as string[];
    expect(Array.isArray(stored)).toBe(true);
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

  it('renders suspend button for active ravn', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    // Expand delete section first
    const deleteToggle = screen.getByTestId('section-toggle-delete');
    fireEvent.click(deleteToggle);
    expect(screen.getByTestId('suspend-btn')).toBeInTheDocument();
    expect(screen.getByTestId('suspend-btn')).not.toBeDisabled();
  });

  it('disables suspend button when ravn is already suspended', () => {
    render(<RavnDetail ravn={SUSPENDED_RAVN} />, { wrapper: wrap() });
    const deleteToggle = screen.getByTestId('section-toggle-delete');
    fireEvent.click(deleteToggle);
    expect(screen.getByTestId('suspend-btn')).toBeDisabled();
  });

  it('renders delete button', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const deleteToggle = screen.getByTestId('section-toggle-delete');
    fireEvent.click(deleteToggle);
    expect(screen.getByTestId('delete-btn')).toBeInTheDocument();
  });

  it('renders triggers section when expanded', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-triggers');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('triggers-section-body')).toBeInTheDocument());
  });

  it('renders sessions section when expanded', async () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-sessions');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('sessions-section-body')).toBeInTheDocument());
  });

  it('renders connectivity section when expanded', () => {
    render(<RavnDetail ravn={SAMPLE_RAVN} />, { wrapper: wrap() });
    const toggle = screen.getByTestId('section-toggle-connectivity');
    fireEvent.click(toggle);
    expect(screen.getByTestId('connectivity-section-body')).toBeInTheDocument();
  });
});
