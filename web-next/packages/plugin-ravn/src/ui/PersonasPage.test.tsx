import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PersonasPage } from './PersonasPage';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockTriggerStore,
  createMockSessionStream,
  createMockBudgetStream,
} from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

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

describe('PersonasPage', () => {
  it('renders the personas-page container', () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    expect(screen.getByTestId('personas-page')).toBeInTheDocument();
  });

  it('shows empty state when no persona is selected', () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    expect(screen.getByTestId('personas-empty-state')).toBeInTheDocument();
  });

  it('does not show the persona list inside the page', () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    // Persona list lives in the subnav, not in the page
    expect(screen.queryByTestId('persona-list')).not.toBeInTheDocument();
  });

  it('shows persona detail when ravn:persona-selected event is dispatched', async () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    expect(screen.getByTestId('personas-empty-state')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent('ravn:persona-selected', { detail: 'coding-agent' }));
    });

    await waitFor(() => expect(screen.getByTestId('persona-detail')).toBeInTheDocument());
  });

  it('persists selection to localStorage on event', async () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });

    act(() => {
      window.dispatchEvent(new CustomEvent('ravn:persona-selected', { detail: 'reviewer' }));
    });

    await waitFor(() => {
      const stored = localStorage.getItem('ravn.persona');
      expect(stored).toBe('"reviewer"');
    });
  });

  it('restores selected persona from localStorage on mount', async () => {
    localStorage.setItem('ravn.persona', '"architect"');
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    await waitFor(() => expect(screen.getByTestId('persona-detail')).toBeInTheDocument());
  });

  it('shows form tab by default after selection', async () => {
    render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });

    act(() => {
      window.dispatchEvent(new CustomEvent('ravn:persona-selected', { detail: 'coding-agent' }));
    });

    await waitFor(() => {
      const formTab = screen.getByRole('tab', { name: /form/i });
      expect(formTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('removes event listener on unmount', () => {
    const { unmount } = render(<PersonasPage />, { wrapper: wrapWithServices(allServices()) });
    unmount();
    // No error should occur if we dispatch after unmount
    expect(() => {
      window.dispatchEvent(new CustomEvent('ravn:persona-selected', { detail: 'coding-agent' }));
    }).not.toThrow();
  });
});
