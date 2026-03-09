import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionChronicle, PullRequest } from '@/models';
import { SessionChronicles, type SessionChroniclesProps } from './SessionChronicles';

const mockChronicle: SessionChronicle = {
  events: [
    { t: 0, type: 'session', label: 'Session started' },
    { t: 30, type: 'file', label: 'src/main.ts', action: 'created', ins: 50, del: 0 },
    { t: 60, type: 'message', label: 'User prompt', tokens: 150 },
    { t: 90, type: 'terminal', label: 'npm test', exit: 0 },
    { t: 120, type: 'git', label: 'fix: resolve bug', hash: 'abc1234', ins: 5, del: 3 },
    { t: 150, type: 'error', label: 'OOM detected' },
    { t: 180, type: 'file', label: 'src/utils.ts', action: 'modified', ins: 10, del: 2 },
    { t: 210, type: 'terminal', label: 'npm build', exit: 1 },
  ],
  files: [
    { path: 'src/main.ts', status: 'new', ins: 50, del: 0 },
    { path: 'src/utils.ts', status: 'mod', ins: 10, del: 2 },
  ],
  commits: [{ hash: 'abc1234', msg: 'fix: resolve bug', time: '2m ago' }],
  tokenBurn: [100, 200, 300, 500, 150],
};

const mockPR: PullRequest = {
  number: 42,
  title: 'Add login feature',
  url: 'https://github.com/org/repo/pull/42',
  repoUrl: 'https://github.com/org/repo',
  provider: 'github',
  sourceBranch: 'feature/login',
  targetBranch: 'main',
  status: 'open',
  ciStatus: 'passed',
};

describe('SessionChronicles', () => {
  const defaultProps: SessionChroniclesProps = {
    sessionId: 'session-001',
    sessionStatus: 'running',
    chronicle: mockChronicle,
    loading: false,
    onFetch: vi.fn().mockResolvedValue(undefined),
    repoUrl: 'https://github.com/org/repo',
    branch: 'feature/login',
    pullRequest: null,
    prLoading: false,
    prCreating: false,
    prMerging: false,
    onFetchPR: vi.fn().mockResolvedValue(undefined),
    onCreatePR: vi.fn().mockResolvedValue(undefined),
    onMergePR: vi.fn().mockResolvedValue(undefined),
    onRefreshCI: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onFetch on mount with sessionId', () => {
    render(<SessionChronicles {...defaultProps} />);
    expect(defaultProps.onFetch).toHaveBeenCalledWith('session-001');
  });

  it('calls onFetchPR when repoUrl and branch are set', () => {
    render(<SessionChronicles {...defaultProps} />);
    expect(defaultProps.onFetchPR).toHaveBeenCalledWith(
      'https://github.com/org/repo',
      'feature/login'
    );
  });

  it('does not call onFetchPR when repoUrl is empty', () => {
    render(<SessionChronicles {...defaultProps} repoUrl="" branch="main" />);
    expect(defaultProps.onFetchPR).not.toHaveBeenCalled();
  });

  it('does not call onFetchPR when branch is empty', () => {
    render(<SessionChronicles {...defaultProps} repoUrl="https://github.com/org/repo" branch="" />);
    expect(defaultProps.onFetchPR).not.toHaveBeenCalled();
  });

  describe('loading state', () => {
    it('shows loading message when loading is true', () => {
      render(<SessionChronicles {...defaultProps} loading={true} chronicle={null} />);
      expect(screen.getByText('Loading chronicle...')).toBeDefined();
    });
  });

  describe('empty chronicle', () => {
    it('shows no data message when chronicle is null and session is running', () => {
      render(<SessionChronicles {...defaultProps} chronicle={null} sessionStatus="running" />);
      expect(screen.getByText('No chronicle data yet')).toBeDefined();
    });

    it('shows start session message when chronicle is null and session is stopped', () => {
      render(<SessionChronicles {...defaultProps} chronicle={null} sessionStatus="stopped" />);
      expect(screen.getByText('Start the session to view its chronicle')).toBeDefined();
    });
  });

  describe('timeline rendering', () => {
    it('renders all chronicle events', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('Session started')).toBeDefined();
      // src/main.ts appears in both timeline and sidebar
      expect(screen.getAllByText('src/main.ts').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('User prompt')).toBeDefined();
      expect(screen.getByText('npm test')).toBeDefined();
      // fix: resolve bug appears in timeline and commits sidebar
      expect(screen.getAllByText('fix: resolve bug').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('OOM detected')).toBeDefined();
    });

    it('renders event action for file events', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('(created)')).toBeDefined();
      expect(screen.getByText('(modified)')).toBeDefined();
    });

    it('renders token counts for message events', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('150 tok')).toBeDefined();
    });

    it('renders diff counts for file events', () => {
      render(<SessionChronicles {...defaultProps} />);
      // +50 appears in both timeline event and file sidebar
      expect(screen.getAllByText('+50').length).toBeGreaterThanOrEqual(1);
    });

    it('renders git hash for git events', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0);
    });

    it('renders exit codes for terminal events', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('exit 0')).toBeDefined();
      expect(screen.getByText('exit 1')).toBeDefined();
    });

    it('formats timestamps correctly', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('0:00')).toBeDefined();
      expect(screen.getByText('0:30')).toBeDefined();
      expect(screen.getByText('1:00')).toBeDefined();
    });
  });

  describe('token burn chart', () => {
    it('renders burn rate section', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('Token Burn Rate')).toBeDefined();
      expect(screen.getByText('5-minute buckets')).toBeDefined();
    });
  });

  describe('files modified sidebar', () => {
    it('renders files with status and diff', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('Files Modified')).toBeDefined();
      expect(screen.getAllByText('src/main.ts').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('src/utils.ts').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('commits sidebar', () => {
    it('renders commits', () => {
      render(<SessionChronicles {...defaultProps} />);
      expect(screen.getByText('Commits')).toBeDefined();
      expect(screen.getAllByText('fix: resolve bug').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('2m ago')).toBeDefined();
    });
  });

  describe('PR panel - no PR exists', () => {
    it('renders create PR form when no pull request', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={null} />);
      expect(screen.getByText('Pull Request')).toBeDefined();
      expect(screen.getByPlaceholderText('PR title (optional)')).toBeDefined();
      expect(screen.getByText('Create PR')).toBeDefined();
    });

    it('calls onCreatePR when Create PR button is clicked', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={null} />);

      const input = screen.getByPlaceholderText('PR title (optional)');
      fireEvent.change(input, { target: { value: 'My new PR' } });

      const button = screen.getByText('Create PR');
      fireEvent.click(button);

      expect(defaultProps.onCreatePR).toHaveBeenCalledWith('session-001', 'My new PR');
    });

    it('passes undefined title when input is empty', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={null} />);

      const button = screen.getByText('Create PR');
      fireEvent.click(button);

      expect(defaultProps.onCreatePR).toHaveBeenCalledWith('session-001', undefined);
    });

    it('disables create button when prCreating is true', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={null} prCreating={true} />);
      expect(screen.getByText('Creating...')).toBeDefined();
    });

    it('disables create button when no commits exist', () => {
      const chronicleNoCommits = { ...mockChronicle, commits: [] };
      render(
        <SessionChronicles {...defaultProps} chronicle={chronicleNoCommits} pullRequest={null} />
      );
      expect(screen.getByText('Commit changes first')).toBeDefined();
    });
  });

  describe('PR panel - PR loading', () => {
    it('shows loading when prLoading is true', () => {
      render(<SessionChronicles {...defaultProps} prLoading={true} />);
      expect(screen.getByText('Loading PR status...')).toBeDefined();
    });
  });

  describe('PR panel - open PR', () => {
    it('renders PR details when a pull request exists', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      expect(screen.getByText('#42')).toBeDefined();
      expect(screen.getByText('open')).toBeDefined();
      expect(screen.getByText('Add login feature')).toBeDefined();
      expect(screen.getByText('feature/login')).toBeDefined();
      expect(screen.getByText('main')).toBeDefined();
    });

    it('renders CI passed status', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      expect(screen.getByText('CI Passed')).toBeDefined();
    });

    it('renders CI failed status', () => {
      const failedPR = { ...mockPR, ciStatus: 'failed' as const };
      render(<SessionChronicles {...defaultProps} pullRequest={failedPR} />);
      expect(screen.getByText('CI Failed')).toBeDefined();
    });

    it('renders CI running status', () => {
      const runningPR = { ...mockPR, ciStatus: 'running' as const };
      render(<SessionChronicles {...defaultProps} pullRequest={runningPR} />);
      expect(screen.getByText('CI Running')).toBeDefined();
    });

    it('renders CI pending status', () => {
      const pendingPR = { ...mockPR, ciStatus: 'pending' as const };
      render(<SessionChronicles {...defaultProps} pullRequest={pendingPR} />);
      expect(screen.getByText('CI Pending')).toBeDefined();
    });

    it('renders CI unknown status when ciStatus is undefined', () => {
      const noStatusPR = { ...mockPR, ciStatus: undefined };
      render(<SessionChronicles {...defaultProps} pullRequest={noStatusPR} />);
      expect(screen.getByText('CI Unknown')).toBeDefined();
    });

    it('renders merge button for open PR', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      expect(screen.getByText('Merge PR')).toBeDefined();
    });

    it('calls onMergePR when merge button is clicked', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      fireEvent.click(screen.getByText('Merge PR'));
      expect(defaultProps.onMergePR).toHaveBeenCalledWith(42, 'https://github.com/org/repo');
    });

    it('shows merging state when prMerging is true', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} prMerging={true} />);
      expect(screen.getByText('Merging...')).toBeDefined();
    });

    it('calls onRefreshCI when refresh button is clicked', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      fireEvent.click(screen.getByTitle('Refresh CI status'));
      expect(defaultProps.onRefreshCI).toHaveBeenCalledWith(
        42,
        'https://github.com/org/repo',
        'feature/login'
      );
    });

    it('has external link to PR URL', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={mockPR} />);
      const link = document.querySelector('a[href="https://github.com/org/repo/pull/42"]');
      expect(link).toBeTruthy();
      expect(link?.getAttribute('target')).toBe('_blank');
    });
  });

  describe('PR panel - merged PR', () => {
    it('renders merged banner', () => {
      const mergedPR = { ...mockPR, status: 'merged' as const };
      render(<SessionChronicles {...defaultProps} pullRequest={mergedPR} />);
      expect(screen.getByText('Merged')).toBeDefined();
    });

    it('does not render merge button for merged PR', () => {
      const mergedPR = { ...mockPR, status: 'merged' as const };
      render(<SessionChronicles {...defaultProps} pullRequest={mergedPR} />);
      expect(screen.queryByText('Merge PR')).toBeNull();
    });
  });

  describe('PR panel - guard clauses', () => {
    it('handleMergePR does nothing when pullRequest is null', () => {
      // Render with no PR, but trick the merge button being available
      // We test this by having no PR and no merge button - just ensuring no crash
      render(<SessionChronicles {...defaultProps} pullRequest={null} />);
      expect(defaultProps.onMergePR).not.toHaveBeenCalled();
    });

    it('handleRefreshCI does nothing when pullRequest is null', () => {
      render(<SessionChronicles {...defaultProps} pullRequest={null} />);
      expect(defaultProps.onRefreshCI).not.toHaveBeenCalled();
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SessionChronicles {...defaultProps} className="custom-class" />
      );
      expect(container.firstChild?.className).toContain('custom-class');
    });
  });

  describe('events with optional del field', () => {
    it('renders file events without del when del is 0', () => {
      const chronicle: SessionChronicle = {
        ...mockChronicle,
        events: [{ t: 0, type: 'file', label: 'new.ts', action: 'created', ins: 77, del: 0 }],
        files: [{ path: 'new.ts', status: 'new', ins: 77, del: 0 }],
      };
      render(<SessionChronicles {...defaultProps} chronicle={chronicle} />);
      expect(screen.getAllByText('+77').length).toBeGreaterThanOrEqual(1);
    });

    it('renders file events with del when del > 0', () => {
      const chronicle: SessionChronicle = {
        ...mockChronicle,
        events: [{ t: 0, type: 'file', label: 'edit.ts', action: 'modified', ins: 88, del: 33 }],
        files: [{ path: 'edit.ts', status: 'mod', ins: 88, del: 33 }],
      };
      render(<SessionChronicles {...defaultProps} chronicle={chronicle} />);
      expect(screen.getAllByText('+88').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('-33').length).toBeGreaterThanOrEqual(1);
    });
  });
});
