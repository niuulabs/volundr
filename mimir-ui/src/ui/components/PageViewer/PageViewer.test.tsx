import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageViewer } from './PageViewer';
import type { MimirPage } from '@/domain';

const page: MimirPage = {
  path: 'technical/ravn/architecture.md',
  title: 'Ravn Architecture',
  summary: 'Overview of Ravn',
  category: 'technical',
  updatedAt: '2026-04-08T12:00:00Z',
  sourceIds: ['src_abc', 'src_def'],
  content: '# Ravn Architecture\n\nThis is the content.',
};

describe('PageViewer', () => {
  describe('when page is null', () => {
    it('shows "Select a page to view"', () => {
      render(<PageViewer page={null} onLinkClick={vi.fn()} />);
      expect(screen.getByText('Select a page to view')).toBeDefined();
    });
  });

  describe('with a page', () => {
    it('renders the page title', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      // Title appears at least once (in <h1>)
      expect(screen.getAllByText('Ravn Architecture').length).toBeGreaterThan(0);
    });

    it('renders the page path', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      expect(screen.getByText('technical/ravn/architecture.md')).toBeDefined();
    });

    it('renders the category badge', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      expect(screen.getByText('technical')).toBeDefined();
    });

    it('renders the "Updated" label', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      expect(screen.getByText('Updated')).toBeDefined();
    });

    it('renders the Sources count when sourceIds is non-empty', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      expect(screen.getByText('Sources')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
    });

    it('does not show Sources when sourceIds is empty', () => {
      render(
        <PageViewer page={{ ...page, sourceIds: [] }} onLinkClick={vi.fn()} />,
      );
      expect(screen.queryByText('Sources')).toBeNull();
    });

    it('renders markdown content as HTML', () => {
      render(<PageViewer page={page} onLinkClick={vi.fn()} />);
      // ReactMarkdown renders the # heading — content area should have paragraph text
      expect(screen.getByText('This is the content.')).toBeDefined();
    });
  });

  describe('link handling', () => {
    it('calls onLinkClick for internal links', async () => {
      const onLinkClick = vi.fn();
      const pageWithLink: MimirPage = {
        ...page,
        content: '[See cascade](technical/ravn/cascade.md)',
      };
      render(<PageViewer page={pageWithLink} onLinkClick={onLinkClick} />);
      const link = await screen.findByText('See cascade');
      fireEvent.click(link);
      expect(onLinkClick).toHaveBeenCalledWith('technical/ravn/cascade.md');
    });

    it('does not call onLinkClick for external links', async () => {
      const onLinkClick = vi.fn();
      const pageWithExternal: MimirPage = {
        ...page,
        content: '[External](https://example.com)',
      };
      render(<PageViewer page={pageWithExternal} onLinkClick={onLinkClick} />);
      const link = await screen.findByText('External');
      fireEvent.click(link);
      expect(onLinkClick).not.toHaveBeenCalled();
    });
  });
});
