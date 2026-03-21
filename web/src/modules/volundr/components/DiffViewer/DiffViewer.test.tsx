import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DiffData } from '@/modules/volundr/models';
import { DiffViewer } from './DiffViewer';

const mockDiff: DiffData = {
  filePath: 'src/component.tsx',
  hunks: [
    {
      oldStart: 1,
      oldCount: 5,
      newStart: 1,
      newCount: 7,
      lines: [
        { type: 'context', content: "import React from 'react';", oldLine: 1, newLine: 1 },
        { type: 'remove', content: "import { Old } from './old';", oldLine: 2 },
        { type: 'add', content: "import { New } from './new';", newLine: 2 },
        { type: 'add', content: "import { Extra } from './extra';", newLine: 3 },
        { type: 'context', content: '', oldLine: 3, newLine: 4 },
        { type: 'context', content: 'export function Component() {', oldLine: 4, newLine: 5 },
      ],
    },
    {
      oldStart: 10,
      oldCount: 3,
      newStart: 12,
      newCount: 3,
      lines: [
        { type: 'context', content: '  return null;', oldLine: 10, newLine: 12 },
        { type: 'context', content: '}', oldLine: 11, newLine: 13 },
        { type: 'context', content: '', oldLine: 12, newLine: 14 },
      ],
    },
  ],
};

describe('DiffViewer', () => {
  it('shows placeholder when no diff is selected', () => {
    render(<DiffViewer diff={null} loading={false} error={null} />);
    expect(screen.getByText('Select a file to view changes')).toBeDefined();
  });

  it('shows loading state', () => {
    render(<DiffViewer diff={null} loading={true} error={null} />);
    expect(screen.getByText('Loading diff...')).toBeDefined();
  });

  it('shows error state', () => {
    render(<DiffViewer diff={null} loading={false} error={new Error('Network error')} />);
    expect(screen.getByText('Failed to load diff: Network error')).toBeDefined();
  });

  it('shows empty diff message when hunks are empty', () => {
    const emptyDiff: DiffData = { filePath: 'src/empty.ts', hunks: [] };
    render(<DiffViewer diff={emptyDiff} loading={false} error={null} />);
    expect(screen.getByText('No changes in this file')).toBeDefined();
  });

  it('renders file path in header', () => {
    render(<DiffViewer diff={mockDiff} loading={false} error={null} />);
    expect(screen.getByText('src/component.tsx')).toBeDefined();
  });

  it('renders hunk headers', () => {
    render(<DiffViewer diff={mockDiff} loading={false} error={null} />);
    expect(screen.getByText('@@ -1,5 +1,7 @@')).toBeDefined();
    expect(screen.getByText('@@ -10,3 +12,3 @@')).toBeDefined();
  });

  it('renders context lines', () => {
    render(<DiffViewer diff={mockDiff} loading={false} error={null} />);
    expect(screen.getByText("import React from 'react';")).toBeDefined();
    expect(screen.getByText('export function Component() {')).toBeDefined();
  });

  it('renders add lines with + prefix', () => {
    const { container } = render(<DiffViewer diff={mockDiff} loading={false} error={null} />);

    const addPrefixes = container.querySelectorAll('[data-type="add"]');
    expect(addPrefixes.length).toBeGreaterThan(0);
    expect(screen.getByText("import { New } from './new';")).toBeDefined();
    expect(screen.getByText("import { Extra } from './extra';")).toBeDefined();
  });

  it('renders remove lines with - prefix', () => {
    const { container } = render(<DiffViewer diff={mockDiff} loading={false} error={null} />);

    const removePrefixes = container.querySelectorAll('[data-type="remove"]');
    expect(removePrefixes.length).toBeGreaterThan(0);
    expect(screen.getByText("import { Old } from './old';")).toBeDefined();
  });

  it('renders line numbers', () => {
    render(<DiffViewer diff={mockDiff} loading={false} error={null} />);

    // Context line 1 should show both old and new line numbers
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
  });

  it('renders prefix symbols', () => {
    const { container } = render(<DiffViewer diff={mockDiff} loading={false} error={null} />);

    const prefixes = container.querySelectorAll('[class*="linePrefix"]');
    const prefixTexts = Array.from(prefixes).map(p => p.textContent);

    expect(prefixTexts).toContain('+');
    expect(prefixTexts).toContain('-');
  });

  it('applies custom className', () => {
    const { container } = render(
      <DiffViewer diff={mockDiff} loading={false} error={null} className="custom" />
    );

    expect(container.firstChild?.className).toContain('custom');
  });

  it('renders empty line content as non-breaking space', () => {
    const diffWithEmpty: DiffData = {
      filePath: 'test.ts',
      hunks: [
        {
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 1,
          lines: [{ type: 'context', content: '', oldLine: 1, newLine: 1 }],
        },
      ],
    };
    const { container } = render(<DiffViewer diff={diffWithEmpty} loading={false} error={null} />);

    const lineContents = container.querySelectorAll('[class*="lineContent"]');
    expect(lineContents.length).toBeGreaterThan(0);
    // Empty content renders as non-breaking space
    expect(lineContents[0].textContent).toBe('\u00A0');
  });
});
