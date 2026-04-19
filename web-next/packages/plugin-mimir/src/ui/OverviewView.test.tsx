import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithMimir as wrap } from '../testing/renderWithMimir';
import { OverviewView } from './OverviewView';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

describe('OverviewView', () => {
  it('renders loading state initially', () => {
    wrap(<OverviewView />);
    expect(screen.getByText(/loading/)).toBeInTheDocument();
  });

  it('renders KPI strip after data loads', async () => {
    wrap(<OverviewView />);
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'KPI metrics' })).toBeInTheDocument(),
    );
    const strip = screen.getByRole('group', { name: 'KPI metrics' });
    expect(within(strip).getByText('pages')).toBeInTheDocument();
    expect(within(strip).getByText('sources')).toBeInTheDocument();
    expect(within(strip).getByText('lint issues')).toBeInTheDocument();
    expect(within(strip).getByText('last write')).toBeInTheDocument();
  });

  it('renders mount cards with names and roles', async () => {
    wrap(<OverviewView />);
    await waitFor(() => expect(screen.getAllByText('local').length).toBeGreaterThan(0));
    expect(screen.getAllByText('shared').length).toBeGreaterThan(0);
    expect(screen.getAllByText('platform').length).toBeGreaterThan(0);
  });

  it('renders the activity feed', async () => {
    wrap(<OverviewView />);
    await waitFor(() =>
      expect(screen.getByRole('log', { name: /recent writes/ })).toBeInTheDocument(),
    );
  });

  it('shows total page count from all mounts', async () => {
    wrap(<OverviewView />);
    // Mock has 42 + 210 + 65 = 317 pages
    await waitFor(() => expect(screen.getByText('317')).toBeInTheDocument());
  });

  it('shows "clean" when no lint issues', async () => {
    const noLintService: IMimirService = {
      ...createMimirMockAdapter(),
      mounts: {
        ...createMimirMockAdapter().mounts,
        async listMounts() {
          return [
            {
              name: 'test',
              role: 'local',
              host: 'localhost',
              url: 'http://localhost',
              priority: 1,
              categories: null,
              status: 'healthy',
              pages: 5,
              sources: 2,
              lintIssues: 0,
              lastWrite: '2026-04-19T00:00:00Z',
              embedding: 'minilm',
              sizeKb: 100,
              desc: 'test mount',
            },
          ];
        },
      },
    };
    wrap(<OverviewView />, noLintService);
    await waitFor(() => expect(screen.getByText('clean')).toBeInTheDocument());
  });
});
