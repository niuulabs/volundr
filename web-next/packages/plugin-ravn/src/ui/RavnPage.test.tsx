import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RavnPage } from './RavnPage';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockTriggerStore,
  createMockSessionStream,
  createMockBudgetStream,
} from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

const wrap = wrapWithServices;

function allServices() {
  return {
    'ravn.personas': createMockPersonaStore(),
    'ravn.ravens': createMockRavenStream(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.budget': createMockBudgetStream(),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('RavnPage', () => {
  it('renders the ravn page wrapper', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByTestId('ravn-page')).toBeInTheDocument();
  });

  it('renders the ravn rune glyph', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByText('ᚱ')).toBeInTheDocument();
  });

  it('renders the page title', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByText(/Ravn · the flock/)).toBeInTheDocument();
  });

  it('renders overview and ravens tabs', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByTestId('ravn-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('ravn-tab-ravens')).toBeInTheDocument();
  });

  it('renders sessions, triggers, events, budget, log tabs', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Triggers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Log' })).toBeInTheDocument();
  });

  it('defaults to the overview tab', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });

  it('Overview tab is selected by default', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    expect(screen.getByTestId('ravn-tab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the ravens tab', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    await waitFor(() => expect(screen.getByTestId('ravens-page')).toBeInTheDocument());
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('switches back to overview tab', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    await waitFor(() => screen.getByTestId('ravens-page'));
    fireEvent.click(screen.getByTestId('ravn-tab-overview'));
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
  });

  it('switching to Triggers tab shows triggers content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    fireEvent.click(screen.getByRole('tab', { name: 'Triggers' }));
    expect(screen.getByRole('tab', { name: 'Triggers' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /cron triggers/i })).toBeInTheDocument(),
    );
  });

  it('switching to Events tab shows events content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await waitFor(() => expect(screen.getByLabelText(/event graph/i)).toBeInTheDocument());
  });

  it('switching to Budget tab shows budget content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    fireEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    await waitFor(() => expect(screen.getByLabelText(/fleet budget/i)).toBeInTheDocument());
  });

  it('switching to Log tab shows log content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    fireEvent.click(screen.getByRole('tab', { name: 'Log' }));
    expect(screen.getByRole('log', { name: /event log/i })).toBeInTheDocument();
  });

  it('tab panel has correct aria-labelledby', () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'ravn-tab-overview');
  });

  it('persists active tab to localStorage', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    await waitFor(() => screen.getByTestId('ravn-tab-ravens'));
    fireEvent.click(screen.getByTestId('ravn-tab-ravens'));
    expect(localStorage.getItem('ravn.tab')).toBe('"ravens"');
  });

  it('restores tab from localStorage on mount', async () => {
    localStorage.setItem('ravn.tab', '"ravens"');
    render(<RavnPage />, { wrapper: wrap(allServices()) });
    await waitFor(() => expect(screen.getByTestId('ravens-page')).toBeInTheDocument());
  });
});
