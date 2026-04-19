import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMimir as wrap } from '../testing/renderWithMimir';
import { PagesView } from './PagesView';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

describe('PagesView', () => {
  it('renders the page tree sidebar', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: /page tree/ })).toBeInTheDocument(),
    );
  });

  it('shows directory nodes from page paths', async () => {
    wrap(<PagesView />);
    // Mock has pages at /arch/*, /api/*, /infra/*
    await waitFor(() => expect(screen.getByText('arch/')).toBeInTheDocument());
    expect(screen.getByText('api/')).toBeInTheDocument();
    expect(screen.getByText('infra/')).toBeInTheDocument();
  });

  it('renders the page count badge', async () => {
    wrap(<PagesView />);
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('displays a page title and summary when a page is selected', async () => {
    wrap(<PagesView />);
    await waitFor(() => expect(screen.getByText('arch/')).toBeInTheDocument());
    // Click on "arch/" dir to expand (it opens by default at depth 0)
    // Then click on overview leaf — use [0] because /arch/overview and /api/overview both render "overview"
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getByText('Architecture Overview')).toBeInTheDocument(),
    );
  });

  it('renders zone blocks for the selected page', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getByText('Key facts')).toBeInTheDocument(),
    );
  });

  it('shows an edit button for each zone in idle state', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /edit .* zone/ }).length).toBeGreaterThan(0),
    );
  });

  it('enters edit mode when the edit button is clicked', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit key-facts zone/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /edit key-facts zone/ }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /zone edit area/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /save key-facts zone/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel edit/ })).toBeInTheDocument();
  });

  it('cancels edit when cancel is clicked', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edit key-facts zone/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /edit key-facts zone/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel edit/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel edit/ }));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /zone edit area/ })).toBeNull(),
    );
  });

  it('renders the meta panel with page provenance', async () => {
    wrap(<PagesView />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /overview/ }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /overview/ })[0]);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: /page metadata/ })).toBeInTheDocument(),
    );
    expect(screen.getByText('Provenance')).toBeInTheDocument();
  });
});
