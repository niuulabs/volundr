import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphPage } from './GraphPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';

const wrap = renderWithMimir;

describe('GraphPage', () => {
  it('renders the page title', () => {
    wrap(<GraphPage />);
    expect(screen.getByRole('heading', { name: /knowledge graph/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<GraphPage />);
    expect(screen.getByText(/loading graph/)).toBeInTheDocument();
  });

  it('renders graph nodes after load', async () => {
    wrap(<GraphPage />);
    await waitFor(() => expect(screen.getByText(/nodes/)).toBeInTheDocument());
  });

  it('renders the SVG graph canvas', async () => {
    wrap(<GraphPage />);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /knowledge graph/i })).toBeInTheDocument(),
    );
  });

  it('renders hop selector buttons', () => {
    wrap(<GraphPage />);
    expect(screen.getByRole('group', { name: /hop count/i })).toBeInTheDocument();
  });

  it('hop 2 is active by default', () => {
    wrap(<GraphPage />);
    const hopBtns = screen.getAllByRole('button', { name: /\d/ });
    const hop2Btn = hopBtns.find((b) => b.getAttribute('data-hops') === '2');
    expect(hop2Btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a hop button updates active state', () => {
    wrap(<GraphPage />);
    const hop1Btn = screen.getByRole('button', { name: '1' });
    fireEvent.click(hop1Btn);
    expect(hop1Btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('entering a focus node shows clear button', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const focusInput = screen.getByLabelText(/focus node id/i);
    fireEvent.change(focusInput, { target: { value: '/arch/overview' } });
    expect(screen.getByRole('button', { name: /clear focus/i })).toBeInTheDocument();
  });

  it('clearing focus removes the clear button', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const focusInput = screen.getByLabelText(/focus node id/i);
    fireEvent.change(focusInput, { target: { value: '/arch/overview' } });
    fireEvent.click(screen.getByRole('button', { name: /clear focus/i }));
    expect(screen.queryByRole('button', { name: /clear focus/i })).not.toBeInTheDocument();
  });

  it('shows error state when graph load fails', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        getGraph: async () => {
          throw new Error('graph service unavailable');
        },
      },
    };
    wrap(<GraphPage />, failing);
    await waitFor(() =>
      expect(screen.getByText('graph service unavailable')).toBeInTheDocument(),
    );
  });
});
