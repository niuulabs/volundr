import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PullRequest, McpServer } from '@/modules/volundr/models';
import type {
  TokenUsageData,
  ActiveTask,
  ModelConfigData,
} from '@/modules/volundr/hooks/useContextSidebar';
import { ContextSidebar, type ContextSidebarProps } from './ContextSidebar';

const mockTokenUsage: TokenUsageData = {
  totalTokens: 156420,
  burnRate: [1, 2, 4, 3, 5, 8, 6],
  peakBurn: 8,
  averageBurn: 4,
};

const mockActiveTasks: ActiveTask[] = [
  { label: 'Session started', timestamp: 0 },
  { label: 'Review thermal code', timestamp: 30 },
  { label: 'Implement PID filter', timestamp: 90 },
];

const mockPR: PullRequest = {
  number: 42,
  title: 'fix(thermal): add PID improvements',
  url: 'https://github.com/org/repo/pull/42',
  repoUrl: 'https://github.com/org/repo',
  provider: 'github',
  sourceBranch: 'feature/thermal',
  targetBranch: 'main',
  status: 'open',
};

const mockMcpServers: McpServer[] = [
  { name: 'github', status: 'connected', tools: 12 },
  { name: 'filesystem', status: 'disconnected', tools: 8 },
];

const mockModelConfig: ModelConfigData = {
  model: 'claude-sonnet',
  taskType: 'Skuld Claude',
  taskDescription: 'Interactive Claude Code CLI session',
  source: { type: 'git', repo: 'org/repo', branch: 'feature/thermal' },
};

describe('ContextSidebar', () => {
  const defaultProps: ContextSidebarProps = {
    collapsed: false,
    onToggle: vi.fn(),
    tokenUsage: mockTokenUsage,
    activeTasks: mockActiveTasks,
    pullRequest: mockPR,
    mcpServers: mockMcpServers,
    mcpServersLoading: false,
    modelConfig: mockModelConfig,
  };

  it('renders all sections when expanded', () => {
    render(<ContextSidebar {...defaultProps} />);

    expect(screen.getByText('Token Usage')).toBeDefined();
    expect(screen.getByText('Recent Activity')).toBeDefined();
    expect(screen.getByText('Pull Request')).toBeDefined();
    expect(screen.getByText('MCP Servers')).toBeDefined();
    expect(screen.getByText('Model & Config')).toBeDefined();
  });

  it('renders nothing but toggle when collapsed', () => {
    render(<ContextSidebar {...defaultProps} collapsed={true} />);

    expect(screen.queryByText('Token Usage')).toBeNull();
    expect(screen.queryByText('Recent Activity')).toBeNull();
    expect(screen.queryByText('MCP Servers')).toBeNull();
  });

  it('calls onToggle when toggle button is clicked', () => {
    const onToggle = vi.fn();
    render(<ContextSidebar {...defaultProps} onToggle={onToggle} />);

    fireEvent.click(screen.getByTitle('Collapse sidebar'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows expand title when collapsed', () => {
    render(<ContextSidebar {...defaultProps} collapsed={true} />);
    expect(screen.getByTitle('Expand sidebar')).toBeDefined();
  });

  describe('Token Usage Section', () => {
    it('displays formatted token count', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('156.4K')).toBeDefined();
    });

    it('displays peak and average burn', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('8')).toBeDefined();
      expect(screen.getByText('4')).toBeDefined();
    });

    it('does not render when tokenUsage is null', () => {
      render(<ContextSidebar {...defaultProps} tokenUsage={null} />);
      expect(screen.queryByText('Token Usage')).toBeNull();
    });
  });

  describe('Active Tasks Section', () => {
    it('displays task labels', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('Session started')).toBeDefined();
      expect(screen.getByText('Review thermal code')).toBeDefined();
      expect(screen.getByText('Implement PID filter')).toBeDefined();
    });

    it('displays timestamps', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('0:00')).toBeDefined();
      expect(screen.getByText('0:30')).toBeDefined();
      expect(screen.getByText('1:30')).toBeDefined();
    });

    it('does not render section when tasks are empty', () => {
      render(<ContextSidebar {...defaultProps} activeTasks={[]} />);
      expect(screen.queryByText('Recent Activity')).toBeNull();
    });
  });

  describe('Pull Request Section', () => {
    it('displays PR number and title', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('#42')).toBeDefined();
      expect(screen.getByText('fix(thermal): add PID improvements')).toBeDefined();
    });

    it('displays PR status badge', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('open')).toBeDefined();
    });

    it('displays branch names', () => {
      render(<ContextSidebar {...defaultProps} />);
      // feature/thermal appears in both PR branches and model config branch
      expect(screen.getAllByText('feature/thermal').length).toBeGreaterThanOrEqual(1);
      // main appears in PR target branch
      expect(screen.getAllByText('main').length).toBeGreaterThanOrEqual(1);
    });

    it('has external link to PR URL', () => {
      render(<ContextSidebar {...defaultProps} />);
      const link = document.querySelector('a[href="https://github.com/org/repo/pull/42"]');
      expect(link).toBeTruthy();
      expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('does not render when pullRequest is null', () => {
      render(<ContextSidebar {...defaultProps} pullRequest={null} />);
      expect(screen.queryByText('#42')).toBeNull();
    });

    it('renders merged PR with GitMerge icon', () => {
      const mergedPR = { ...mockPR, status: 'merged' as const };
      render(<ContextSidebar {...defaultProps} pullRequest={mergedPR} />);
      expect(screen.getByText('merged')).toBeDefined();
    });
  });

  describe('MCP Servers Section', () => {
    it('displays server names', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('github')).toBeDefined();
      expect(screen.getByText('filesystem')).toBeDefined();
    });

    it('displays tool counts', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('12 tools')).toBeDefined();
      expect(screen.getByText('8 tools')).toBeDefined();
    });

    it('shows loading state', () => {
      render(<ContextSidebar {...defaultProps} mcpServers={[]} mcpServersLoading={true} />);
      expect(screen.getByText('Loading...')).toBeDefined();
    });

    it('shows empty state when no servers', () => {
      render(<ContextSidebar {...defaultProps} mcpServers={[]} mcpServersLoading={false} />);
      expect(screen.getByText('No servers connected')).toBeDefined();
    });
  });

  describe('Model & Config Section', () => {
    it('displays model name', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('claude-sonnet')).toBeDefined();
    });

    it('displays task type', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('Skuld Claude')).toBeDefined();
    });

    it('displays task description', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('Interactive Claude Code CLI session')).toBeDefined();
    });

    it('displays repo and branch', () => {
      render(<ContextSidebar {...defaultProps} />);
      expect(screen.getByText('org/repo')).toBeDefined();
    });

    it('does not render when modelConfig is null', () => {
      render(<ContextSidebar {...defaultProps} modelConfig={null} />);
      expect(screen.queryByText('Model & Config')).toBeNull();
    });

    it('hides description when empty', () => {
      const config = { ...mockModelConfig, taskDescription: '' };
      render(<ContextSidebar {...defaultProps} modelConfig={config} />);
      // "Desc" label should not appear
      expect(screen.queryByText('Desc')).toBeNull();
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(<ContextSidebar {...defaultProps} className="custom-class" />);
      expect(container.firstChild?.className).toContain('custom-class');
    });
  });

  describe('token formatting', () => {
    it('formats millions correctly', () => {
      const usage = { ...mockTokenUsage, totalTokens: 2_500_000 };
      render(<ContextSidebar {...defaultProps} tokenUsage={usage} />);
      expect(screen.getByText('2.5M')).toBeDefined();
    });

    it('formats thousands correctly', () => {
      const usage = { ...mockTokenUsage, totalTokens: 1500 };
      render(<ContextSidebar {...defaultProps} tokenUsage={usage} />);
      expect(screen.getByText('1.5K')).toBeDefined();
    });

    it('formats small numbers without suffix', () => {
      const usage = { ...mockTokenUsage, totalTokens: 500 };
      render(<ContextSidebar {...defaultProps} tokenUsage={usage} />);
      expect(screen.getByText('500')).toBeDefined();
    });
  });
});
