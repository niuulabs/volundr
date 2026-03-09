import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionChronicle, SessionFile, DiffData } from '@/models';
import { SessionDiffs } from './SessionDiffs';

const mockChronicle: SessionChronicle = {
  events: [],
  files: [
    { path: 'src/main.ts', status: 'new', ins: 50, del: 0 },
    { path: 'src/utils.ts', status: 'mod', ins: 10, del: 3 },
    { path: 'src/old.ts', status: 'del', ins: 0, del: 25 },
  ],
  commits: [],
  tokenBurn: [],
};

const mockDiff: DiffData = {
  filePath: 'src/main.ts',
  hunks: [
    {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 5,
      lines: [
        { type: 'context', content: 'line 1', oldLine: 1, newLine: 1 },
        { type: 'add', content: 'new line', newLine: 2 },
        { type: 'add', content: 'another new line', newLine: 3 },
        { type: 'context', content: 'line 2', oldLine: 2, newLine: 4 },
        { type: 'context', content: 'line 3', oldLine: 3, newLine: 5 },
      ],
    },
  ],
};

const defaultProps = {
  sessionId: 'session-1',
  chronicle: mockChronicle,
  chronicleLoading: false,
  onFetchChronicle: vi.fn().mockResolvedValue(undefined),
  liveFiles: [] as SessionFile[],
  liveFilesLoading: false,
  onFetchFiles: vi.fn().mockResolvedValue(undefined),
  diff: null as DiffData | null,
  diffLoading: false,
  diffError: null as Error | null,
  selectedFile: null as string | null,
  diffBase: 'last-commit' as const,
  onSelectFile: vi.fn().mockResolvedValue(undefined),
  onDiffBaseChange: vi.fn(),
};

describe('SessionDiffs', () => {
  it('shows loading state when chronicle is loading', () => {
    render(<SessionDiffs {...defaultProps} chronicleLoading={true} chronicle={null} />);
    expect(screen.getByText('Loading files...')).toBeDefined();
  });

  it('shows empty state when no files changed', () => {
    const emptyChronicle: SessionChronicle = {
      events: [],
      files: [],
      commits: [],
      tokenBurn: [],
    };
    render(<SessionDiffs {...defaultProps} chronicle={emptyChronicle} />);
    expect(screen.getByText('No file changes yet')).toBeDefined();
  });

  it('shows empty state when chronicle is null', () => {
    render(<SessionDiffs {...defaultProps} chronicle={null} />);
    expect(screen.getByText('No file changes yet')).toBeDefined();
  });

  it('renders file summary with counts', () => {
    render(<SessionDiffs {...defaultProps} />);
    expect(screen.getByText('3 files changed')).toBeDefined();
    expect(screen.getByText('+60')).toBeDefined();
    expect(screen.getByText('-28')).toBeDefined();
  });

  it('renders singular file text for single file', () => {
    const singleFileChronicle: SessionChronicle = {
      events: [],
      files: [{ path: 'src/main.ts', status: 'new', ins: 10, del: 0 }],
      commits: [],
      tokenBurn: [],
    };
    render(<SessionDiffs {...defaultProps} chronicle={singleFileChronicle} />);
    expect(screen.getByText('1 file changed')).toBeDefined();
  });

  it('renders file list with all files', () => {
    render(<SessionDiffs {...defaultProps} />);
    expect(screen.getByText('src/main.ts')).toBeDefined();
    expect(screen.getByText('src/utils.ts')).toBeDefined();
    expect(screen.getByText('src/old.ts')).toBeDefined();
  });

  it('shows diff placeholder when no file is selected', () => {
    render(<SessionDiffs {...defaultProps} />);
    expect(screen.getByText('Select a file to view changes')).toBeDefined();
  });

  it('renders diff content when a file is selected', () => {
    render(<SessionDiffs {...defaultProps} diff={mockDiff} selectedFile="src/main.ts" />);
    // File path appears in both file list and diff header
    expect(screen.getAllByText('src/main.ts').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('new line')).toBeDefined();
    expect(screen.getByText('another new line')).toBeDefined();
  });

  it('calls onSelectFile when a file is clicked', () => {
    const onSelectFile = vi.fn().mockResolvedValue(undefined);
    render(<SessionDiffs {...defaultProps} onSelectFile={onSelectFile} />);
    fireEvent.click(screen.getByText('src/utils.ts'));
    expect(onSelectFile).toHaveBeenCalledWith('session-1', 'src/utils.ts');
  });

  it('shows diff loading state', () => {
    render(<SessionDiffs {...defaultProps} diffLoading={true} selectedFile="src/main.ts" />);
    expect(screen.getByText('Loading diff...')).toBeDefined();
  });

  it('shows diff error state', () => {
    render(
      <SessionDiffs
        {...defaultProps}
        diffError={new Error('Network error')}
        selectedFile="src/main.ts"
      />
    );
    expect(screen.getByText('Failed to load diff: Network error')).toBeDefined();
  });

  it('fetches chronicle and files on mount', () => {
    const onFetchChronicle = vi.fn().mockResolvedValue(undefined);
    const onFetchFiles = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionDiffs
        {...defaultProps}
        onFetchChronicle={onFetchChronicle}
        onFetchFiles={onFetchFiles}
      />
    );
    expect(onFetchChronicle).toHaveBeenCalledWith('session-1');
    expect(onFetchFiles).toHaveBeenCalled();
  });

  it('handles pending diff file navigation', () => {
    const onSelectFile = vi.fn().mockResolvedValue(undefined);
    const onPendingDiffConsumed = vi.fn();
    render(
      <SessionDiffs
        {...defaultProps}
        onSelectFile={onSelectFile}
        pendingDiffFile="src/utils.ts"
        onPendingDiffConsumed={onPendingDiffConsumed}
      />
    );
    expect(onSelectFile).toHaveBeenCalledWith('session-1', 'src/utils.ts');
    expect(onPendingDiffConsumed).toHaveBeenCalled();
  });

  it('renders diff base toggle', () => {
    render(<SessionDiffs {...defaultProps} />);
    expect(screen.getByText('Last Commit')).toBeDefined();
    expect(screen.getByText('Default Branch')).toBeDefined();
  });

  it('calls onDiffBaseChange when toggle is clicked', () => {
    const onDiffBaseChange = vi.fn();
    render(<SessionDiffs {...defaultProps} onDiffBaseChange={onDiffBaseChange} />);
    fireEvent.click(screen.getByText('Default Branch'));
    expect(onDiffBaseChange).toHaveBeenCalledWith('default-branch');
  });

  it('applies custom className', () => {
    const { container } = render(<SessionDiffs {...defaultProps} className="custom" />);
    expect(container.firstChild?.className).toContain('custom');
  });

  it('prefers liveFiles over chronicle files when available', () => {
    const liveFiles: SessionFile[] = [{ path: 'README.md', status: 'mod', ins: 3, del: 1 }];
    render(<SessionDiffs {...defaultProps} liveFiles={liveFiles} />);
    expect(screen.getByText('1 file changed')).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
    // chronicle files should not appear
    expect(screen.queryByText('src/main.ts')).toBeNull();
  });

  it('shows liveFilesLoading state', () => {
    render(<SessionDiffs {...defaultProps} chronicle={null} liveFilesLoading={true} />);
    expect(screen.getByText('Loading files...')).toBeDefined();
  });

  it('does not show deletion summary when no deletions', () => {
    const noDelChronicle: SessionChronicle = {
      events: [],
      files: [{ path: 'src/main.ts', status: 'new', ins: 10, del: 0 }],
      commits: [],
      tokenBurn: [],
    };
    render(<SessionDiffs {...defaultProps} chronicle={noDelChronicle} />);
    expect(screen.queryByText('-0')).toBeNull();
  });
});
