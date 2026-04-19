import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MimirPage } from './MimirPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';

const wrap = renderWithMimir;

describe('MimirPage', () => {
  it('renders the rune and title', () => {
    wrap(<MimirPage />);
    expect(screen.getByText('Mímir · the well of knowledge')).toBeInTheDocument();
  });

  it('shows loading state then mount list', async () => {
    wrap(<MimirPage />);
    expect(screen.getByText(/loading mounts/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/mounts connected/)).toBeInTheDocument());
  });

  it('renders mount names from the service', async () => {
    wrap(<MimirPage />);
    await waitFor(() => expect(screen.getAllByText('local').length).toBeGreaterThan(0));
    expect(screen.getAllByText('shared').length).toBeGreaterThan(0);
  });

  it('shows error state when the service throws', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      mounts: {
        listMounts: async () => {
          throw new Error('mount service unavailable');
        },
      },
    };
    wrap(<MimirPage />, failing);
    await waitFor(() => expect(screen.getByText('mount service unavailable')).toBeInTheDocument());
  });

  it('shows count of connected mounts', async () => {
    wrap(<MimirPage />);
    await waitFor(() => expect(screen.getByText(/3/)).toBeInTheDocument());
  });
});
