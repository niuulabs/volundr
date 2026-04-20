import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SessionsView } from './SessionsView';
import { createMockSessionStream, createMockRavenStream } from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

const wrap = wrapWithServices;

const services = {
  'ravn.sessions': createMockSessionStream(),
  'ravn.ravens': createMockRavenStream(),
};

beforeEach(() => {
  localStorage.clear();
});

describe('SessionsView', () => {
  it('shows loading state initially', () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('shows session list after loading', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getAllByText('coding-agent').length).toBeGreaterThan(0));
  });

  it('shows session count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      // '6' appears in both the list-count badge and sidebar msg-count
      expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    });
  });

  it('renders all sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /session/ });
      const names = buttons.map((b) => b.textContent ?? '');
      expect(names.some((n) => n.includes('coding-agent'))).toBe(true);
      expect(names.some((n) => n.includes('reviewer'))).toBe(true);
    });
  });

  it('loads transcript when session is selected', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('shows transcript message count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/messages/)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows error state when service fails', async () => {
    const failing = {
      listSessions: async () => {
        throw new Error('fetch failed');
      },
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': failing, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByText(/failed to load sessions/i)).toBeInTheDocument());
  });

  it('clicking a session item selects it', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(1),
    );
    const items = screen.getAllByRole('button', { name: /session/ });
    fireEvent.click(items[1]!);
    expect(items[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows context sidebar when a session is selected', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('session-context-sidebar')).toBeInTheDocument());
  });

  it('sidebar shows summary section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-summary')).toBeInTheDocument());
  });

  it('sidebar shows timeline section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-timeline')).toBeInTheDocument());
  });

  it('sidebar shows stats section with message count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByTestId('ctx-stats')).toBeInTheDocument();
      expect(screen.getByTestId('ctx-msg-count')).toBeInTheDocument();
    });
  });

  it('sidebar shows raven card', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-raven')).toBeInTheDocument());
  });

  it('responds to ravn:session-selected event', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000002',
        }),
      );
    });

    await waitFor(() => {
      // reviewer session should be selected (ID ends in 002)
      const items = screen.getAllByRole('button', { name: /session/ });
      const reviewerItem = items.find((el) => el.textContent?.includes('reviewer'));
      expect(reviewerItem).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('persists session selection to localStorage', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000003',
        }),
      );
    });

    await waitFor(() => {
      const stored = localStorage.getItem('ravn.session');
      expect(stored).toBe('"10000001-0000-4000-8000-000000000003"');
    });
  });
});
