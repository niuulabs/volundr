import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogViewer } from './LogViewer';

const entries = [
  '## 2026-04-08 ingest complete',
  '## 2026-04-07 lint run complete',
  '## 2026-04-06 error parsing file',
  '## 2026-04-05 update triggered',
];

describe('LogViewer', () => {
  describe('empty state', () => {
    it('shows "No log entries" when entries is empty and no filter', () => {
      render(<LogViewer entries={[]} filter={null} onFilterChange={vi.fn()} />);
      expect(screen.getByText('No log entries')).toBeDefined();
    });

    it('shows filter mismatch message when entries exist but filter matches none', () => {
      render(
        <LogViewer entries={entries} filter="zzznomatch" onFilterChange={vi.fn()} />,
      );
      expect(screen.getByText('No entries match the current filter')).toBeDefined();
    });
  });

  describe('entry rendering', () => {
    it('renders all entries when no filter', () => {
      render(<LogViewer entries={entries} filter={null} onFilterChange={vi.fn()} />);
      expect(screen.getByText('## 2026-04-08 ingest complete')).toBeDefined();
      expect(screen.getByText('## 2026-04-07 lint run complete')).toBeDefined();
    });

    it('shows entry count', () => {
      render(<LogViewer entries={entries} filter={null} onFilterChange={vi.fn()} />);
      expect(screen.getByText(`${entries.length} / ${entries.length}`)).toBeDefined();
    });
  });

  describe('filtering', () => {
    it('filters entries when filter is set', () => {
      render(<LogViewer entries={entries} filter="ingest" onFilterChange={vi.fn()} />);
      expect(screen.getByText('## 2026-04-08 ingest complete')).toBeDefined();
      expect(screen.queryByText('## 2026-04-07 lint run complete')).toBeNull();
    });

    it('shows filtered count', () => {
      render(<LogViewer entries={entries} filter="ingest" onFilterChange={vi.fn()} />);
      expect(screen.getByText('1 / 4')).toBeDefined();
    });

    it('calls onFilterChange when a chip is clicked', () => {
      const onFilterChange = vi.fn();
      render(<LogViewer entries={entries} filter={null} onFilterChange={onFilterChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'ingest' }));
      expect(onFilterChange).toHaveBeenCalledWith('ingest');
    });

    it('toggles filter off when clicking active chip', () => {
      const onFilterChange = vi.fn();
      render(
        <LogViewer entries={entries} filter="ingest" onFilterChange={onFilterChange} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'ingest' }));
      expect(onFilterChange).toHaveBeenCalledWith(null);
    });

    it('shows Clear button when filter is active', () => {
      render(<LogViewer entries={entries} filter="ingest" onFilterChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /clear filter/i })).toBeDefined();
    });

    it('does not show Clear button when no filter', () => {
      render(<LogViewer entries={entries} filter={null} onFilterChange={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /clear filter/i })).toBeNull();
    });

    it('calls onFilterChange(null) when Clear button clicked', () => {
      const onFilterChange = vi.fn();
      render(
        <LogViewer entries={entries} filter="ingest" onFilterChange={onFilterChange} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /clear filter/i }));
      expect(onFilterChange).toHaveBeenCalledWith(null);
    });
  });

  describe('filter chips', () => {
    it('renders all keyword filter chips', () => {
      render(<LogViewer entries={[]} filter={null} onFilterChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'ingest' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'error' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'lint' })).toBeDefined();
    });
  });
});
