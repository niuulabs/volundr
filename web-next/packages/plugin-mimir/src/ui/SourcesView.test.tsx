import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMimir as wrap } from '../testing/renderWithMimir';
import { SourcesView } from './SourcesView';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

describe('SourcesView', () => {
  it('renders origin filter tabs', () => {
    wrap(<SourcesView />);
    expect(screen.getByRole('tab', { name: 'all' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'web' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'file' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'arxiv' })).toBeInTheDocument();
  });

  it('shows all sources by default', async () => {
    wrap(<SourcesView />);
    await waitFor(() => expect(screen.getByText('7 sources')).toBeInTheDocument());
  });

  it('filters sources by origin when a tab is clicked', async () => {
    wrap(<SourcesView />);
    await waitFor(() => expect(screen.getByText('7 sources')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'web' }));
    await waitFor(() => expect(screen.getByText(/1 source/)).toBeInTheDocument());
  });

  it('shows "not compiled yet" for sources not attributed to any page', async () => {
    wrap(<SourcesView />);
    await waitFor(() => expect(screen.getAllByText('not compiled yet').length).toBeGreaterThan(0));
  });

  it('renders origin badges for each source', async () => {
    wrap(<SourcesView />);
    await waitFor(() =>
      expect(screen.getAllByLabelText(/origin:/i).length).toBeGreaterThan(0),
    );
  });

  it('"all" tab is selected by default', () => {
    wrap(<SourcesView />);
    const allTab = screen.getByRole('tab', { name: 'all' });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows loading state', () => {
    // Create a service that never resolves
    const pendingService: IMimirService = {
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        listSources: () => new Promise(() => {}),
      },
    };
    wrap(<SourcesView />, pendingService);
    expect(screen.getByText(/loading sources/)).toBeInTheDocument();
  });

  it('shows error state', async () => {
    const failingService: IMimirService = {
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        listSources: async () => {
          throw new Error('sources unavailable');
        },
      },
    };
    wrap(<SourcesView />, failingService);
    await waitFor(() => expect(screen.getByText('sources unavailable')).toBeInTheDocument());
  });

  it('filters to "file" origin shows only file sources', async () => {
    wrap(<SourcesView />);
    await waitFor(() => expect(screen.getByText('7 sources')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'file' }));
    await waitFor(() => expect(screen.getByText(/2 sources/)).toBeInTheDocument());
  });
});
