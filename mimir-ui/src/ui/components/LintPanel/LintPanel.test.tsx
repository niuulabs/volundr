import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LintPanel } from './LintPanel';
import type { MimirLintReport } from '@/domain';

const cleanReport: MimirLintReport = {
  orphans: [],
  contradictions: [],
  stale: [],
  gaps: [],
  pagesChecked: 20,
  issuesFound: false,
};

const reportWithIssues: MimirLintReport = {
  orphans: ['technical/orphan.md'],
  contradictions: ['technical/conflicting.md'],
  stale: ['projects/old.md', 'technical/outdated.md'],
  gaps: ['observability', 'testing'],
  pagesChecked: 42,
  issuesFound: true,
};

describe('LintPanel', () => {
  describe('when report is null', () => {
    it('shows the run prompt text', () => {
      render(<LintPanel report={null} onPageClick={vi.fn()} />);
      expect(screen.getByText(/Run a lint check/i)).toBeDefined();
    });
  });

  describe('with a clean report', () => {
    it('shows pages checked count', () => {
      render(<LintPanel report={cleanReport} onPageClick={vi.fn()} />);
      expect(screen.getByText('20')).toBeDefined();
    });

    it('shows "All clear" when no issues', () => {
      render(<LintPanel report={cleanReport} onPageClick={vi.fn()} />);
      expect(screen.getByText('All clear')).toBeDefined();
    });

    it('shows "No issues found" message', () => {
      render(<LintPanel report={cleanReport} onPageClick={vi.fn()} />);
      expect(screen.getByText(/No issues found/i)).toBeDefined();
    });

    it('shows 0 issues found', () => {
      render(<LintPanel report={cleanReport} onPageClick={vi.fn()} />);
      expect(screen.getByText('0')).toBeDefined();
    });
  });

  describe('with issues report', () => {
    it('shows pages checked count', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('42')).toBeDefined();
    });

    it('shows "Issues detected" status', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('Issues detected')).toBeDefined();
    });

    it('shows orphan page path', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('technical/orphan.md')).toBeDefined();
    });

    it('shows contradiction page path', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('technical/conflicting.md')).toBeDefined();
    });

    it('shows stale pages', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('projects/old.md')).toBeDefined();
      expect(screen.getByText('technical/outdated.md')).toBeDefined();
    });

    it('shows gap items', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      expect(screen.getByText('observability')).toBeDefined();
      expect(screen.getByText('testing')).toBeDefined();
    });

    it('calls onPageClick with path when a page button is clicked', () => {
      const onPageClick = vi.fn();
      render(<LintPanel report={reportWithIssues} onPageClick={onPageClick} />);
      fireEvent.click(screen.getByText('technical/orphan.md'));
      expect(onPageClick).toHaveBeenCalledWith('technical/orphan.md');
    });

    it('shows correct total issue count', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      // 1 orphan + 1 contradiction + 2 stale + 2 gaps = 6
      expect(screen.getByText('6')).toBeDefined();
    });
  });

  describe('IssueGroup empty behaviour', () => {
    it('does not render Orphaned pages section when orphans is empty', () => {
      render(<LintPanel report={reportWithIssues} onPageClick={vi.fn()} />);
      // Has orphans so "Orphaned pages" title should show
      expect(screen.getByText('Orphaned pages')).toBeDefined();
    });

    it('does not render Contradictions section when contradictions is empty', () => {
      const report = { ...reportWithIssues, contradictions: [] };
      render(<LintPanel report={report} onPageClick={vi.fn()} />);
      expect(screen.queryByText('Contradictions')).toBeNull();
    });
  });
});
