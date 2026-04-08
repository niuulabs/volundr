import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from './FileTree';
import type { MimirPageMeta } from '@/domain';

const pages: MimirPageMeta[] = [
  {
    path: 'technical/ravn/architecture.md',
    title: 'Ravn Architecture',
    summary: 'Overview',
    category: 'technical',
    updatedAt: '2026-04-08T12:00:00Z',
    sourceIds: ['src_abc'],
  },
  {
    path: 'technical/ravn/cascade.md',
    title: 'Cascade Protocol',
    summary: 'Cascading',
    category: 'technical',
    updatedAt: '2026-04-08T12:00:00Z',
    sourceIds: [],
  },
  {
    path: 'projects/niuu/roadmap.md',
    title: 'Niuu Roadmap',
    summary: 'Roadmap',
    category: 'projects',
    updatedAt: '2026-04-08T12:00:00Z',
    sourceIds: ['src_def'],
  },
];

describe('FileTree', () => {
  describe('empty state', () => {
    it('shows "No pages found" when pages is empty', () => {
      render(<FileTree pages={[]} selectedPath={null} onSelect={vi.fn()} />);
      expect(screen.getByText('No pages found')).toBeDefined();
    });
  });

  describe('grouped pages', () => {
    it('renders category headers', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      expect(screen.getByText('technical')).toBeDefined();
      expect(screen.getByText('projects')).toBeDefined();
    });

    it('renders page titles within categories', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      expect(screen.getByText('Ravn Architecture')).toBeDefined();
      expect(screen.getByText('Cascade Protocol')).toBeDefined();
      expect(screen.getByText('Niuu Roadmap')).toBeDefined();
    });

    it('shows page count in category header', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      // technical has 2 pages, projects has 1 page — use getAllByText to handle duplicates
      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThan(0);
      const ones = screen.getAllByText('1');
      expect(ones.length).toBeGreaterThan(0);
    });

    it('shows source count badge for pages with sourceIds', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      // Two pages have 1 source each — the badge should appear for those pages
      const sourceBadges = screen.getAllByTitle(/source/i);
      expect(sourceBadges.length).toBeGreaterThan(0);
    });

    it('does not show source badge for pages with no sourceIds', () => {
      const { container } = render(
        <FileTree
          pages={[
            {
              path: 'technical/a.md',
              title: 'A Page',
              summary: '',
              category: 'technical',
              updatedAt: '2026-04-08T12:00:00Z',
              sourceIds: [],
            },
          ]}
          selectedPath={null}
          onSelect={vi.fn()}
        />,
      );
      // No source count badge
      expect(container.querySelector('[title*="source"]')).toBeNull();
    });
  });

  describe('selection', () => {
    it('calls onSelect with path when a page is clicked', () => {
      const onSelect = vi.fn();
      render(<FileTree pages={pages} selectedPath={null} onSelect={onSelect} />);
      fireEvent.click(screen.getByTitle('technical/ravn/architecture.md'));
      expect(onSelect).toHaveBeenCalledWith('technical/ravn/architecture.md');
    });

    it('marks the selected page', () => {
      const { container } = render(
        <FileTree
          pages={pages}
          selectedPath="technical/ravn/architecture.md"
          onSelect={vi.fn()}
        />,
      );
      const selected = container.querySelector('[data-selected="true"]');
      expect(selected).not.toBeNull();
    });
  });

  describe('collapse/expand', () => {
    it('collapses a category when header is clicked', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      const techHeader = screen.getByRole('button', { name: /technical/ });
      fireEvent.click(techHeader);
      expect(screen.queryByText('Ravn Architecture')).toBeNull();
    });

    it('expands a collapsed category when header is clicked again', () => {
      render(<FileTree pages={pages} selectedPath={null} onSelect={vi.fn()} />);
      const techHeader = screen.getByRole('button', { name: /technical/ });
      fireEvent.click(techHeader); // collapse
      fireEvent.click(techHeader); // expand
      expect(screen.getByText('Ravn Architecture')).toBeDefined();
    });
  });
});
