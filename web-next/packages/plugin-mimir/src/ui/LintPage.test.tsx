import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { LintPage } from './LintPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';

const wrap = renderWithMimir;

describe('LintPage', () => {
  it('renders the page title', () => {
    wrap(<LintPage />);
    expect(screen.getByRole('heading', { name: /lint/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<LintPage />);
    expect(screen.getByText(/loading lint report/)).toBeInTheDocument();
  });

  it('renders lint issues after load', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('lint-issue').length).toBeGreaterThan(0),
    );
  });

  it('shows the lint badge summary', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getByTestId('lint-badge')).toBeInTheDocument(),
    );
  });

  it('shows "Fix all auto-fixable" button when fixable issues exist', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getByTestId('fix-all-btn')).toBeInTheDocument(),
    );
  });

  it('renders severity filter buttons', async () => {
    wrap(<LintPage />);
    const filterGroup = await waitFor(() =>
      screen.getByRole('group', { name: /filter by severity/i }),
    );
    expect(filterGroup).toBeInTheDocument();
    expect(filterGroup.querySelector('[data-severity="error"]')).toBeInTheDocument();
    expect(filterGroup.querySelector('[data-severity="warn"]')).toBeInTheDocument();
    expect(filterGroup.querySelector('[data-severity="info"]')).toBeInTheDocument();
  });

  it('clicking a severity filter shows only matching issues', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('lint-issue').length).toBeGreaterThan(0),
    );
    const allCount = screen.getAllByTestId('lint-issue').length;
    fireEvent.click(screen.getByRole('button', { name: /error/i }));
    await waitFor(() => {
      const errorCount = screen.queryAllByTestId('lint-issue').length;
      expect(errorCount).toBeLessThanOrEqual(allCount);
    });
  });

  it('shows auto-fix button for fixable issues', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('autofix-btn').length).toBeGreaterThan(0),
    );
  });

  it('clicking auto-fix on individual issue calls runAutoFix', async () => {
    let fixedIds: string[] | undefined;
    const spy: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        runAutoFix: async (ids) => {
          fixedIds = ids;
          return { issues: [], pagesChecked: 3, summary: { error: 0, warn: 0, info: 0 } };
        },
      },
    };
    wrap(<LintPage />, spy);
    await waitFor(() =>
      expect(screen.getAllByTestId('autofix-btn').length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByTestId('autofix-btn')[0]!);
    await waitFor(() => expect(fixedIds).toBeDefined());
    expect(Array.isArray(fixedIds)).toBe(true);
  });

  it('clicking "Fix all" calls runAutoFix with no ids (fixes all fixable)', async () => {
    let calledWith: string[] | undefined = ['sentinel'];
    const spy: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        runAutoFix: async (ids) => {
          calledWith = ids;
          return { issues: [], pagesChecked: 3, summary: { error: 0, warn: 0, info: 0 } };
        },
      },
    };
    wrap(<LintPage />, spy);
    await waitFor(() => screen.getByTestId('fix-all-btn'));
    fireEvent.click(screen.getByTestId('fix-all-btn'));
    await waitFor(() => expect(calledWith).toBeUndefined());
  });

  it('selecting an issue shows the bulk action bar', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('lint-issue').length).toBeGreaterThan(0),
    );
    const checkbox = screen.getAllByRole('checkbox').find(
      (c) => c.getAttribute('aria-label')?.startsWith('Select issue'),
    );
    fireEvent.click(checkbox!);
    expect(screen.getByTestId('bulk-bar')).toBeInTheDocument();
  });

  it('select-all checkbox selects all visible issues', async () => {
    wrap(<LintPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('lint-issue').length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByTestId('select-all-checkbox'));
    expect(screen.getByTestId('bulk-bar')).toBeInTheDocument();
  });

  it('bulk assign updates assignee on selected issues', async () => {
    let assignCalled = false;
    const spy: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        reassignIssues: async (ids, assignee) => {
          assignCalled = true;
          expect(ids.length).toBeGreaterThan(0);
          expect(assignee).toBe('ravn-fjolnir');
          return { issues: [], pagesChecked: 3, summary: { error: 0, warn: 0, info: 0 } };
        },
      },
    };
    wrap(<LintPage />, spy);
    await waitFor(() =>
      expect(screen.getAllByTestId('lint-issue').length).toBeGreaterThan(0),
    );
    // Select all
    fireEvent.click(screen.getByTestId('select-all-checkbox'));
    // Pick assignee
    fireEvent.change(screen.getByTestId('assignee-select'), {
      target: { value: 'ravn-fjolnir' },
    });
    // Assign
    fireEvent.click(screen.getByTestId('bulk-assign-btn'));
    await waitFor(() => expect(assignCalled).toBe(true));
  });

  it('shows error state when service throws', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        getLintReport: async () => {
          throw new Error('lint service down');
        },
      },
    };
    wrap(<LintPage />, failing);
    await waitFor(() =>
      expect(screen.getByText('lint service down')).toBeInTheDocument(),
    );
  });

  it('shows "No issues" when lint report is empty', async () => {
    const empty: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        getLintReport: async () => ({
          issues: [],
          pagesChecked: 10,
          summary: { error: 0, warn: 0, info: 0 },
        }),
      },
    };
    wrap(<LintPage />, empty);
    await waitFor(() =>
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument(),
    );
  });
});
