import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DispatcherView } from './DispatcherView';

vi.mock('../../hooks/useDispatchQueue', () => ({
  useDispatchQueue: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages }: { messages?: string[] }) => (
    <div data-testid="loading-indicator">{messages?.[0]}</div>
  ),
}));

import { useDispatchQueue } from '../../hooks/useDispatchQueue';

const mockDefaults = {
  default_system_prompt: 'test prompt',
  default_model: 'claude-sonnet-4-6',
  models: [
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
    { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  ],
};

describe('DispatcherView', () => {
  beforeEach(() => {
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [
        {
          saga_id: 's1',
          saga_name: 'Test Saga',
          saga_slug: 'test',
          repos: ['https://github.com/org/repo'],
          feature_branch: 'feat/test',
          phase_name: 'Phase 1',
          issue_id: 'i1',
          identifier: 'NIU-100',
          title: 'Test issue',
          description: '',
          status: 'Todo',
          priority: 1,
          priority_label: 'Urgent',
          estimate: 3,
          url: '',
        },
      ],
      defaults: mockDefaults,
      loading: false,
      error: null,
      dispatching: false,
      refresh: vi.fn(),
      dispatch: vi.fn(),
    });
  });

  it('renders queue items', () => {
    render(<DispatcherView />);
    expect(screen.getByText('NIU-100')).toBeInTheDocument();
    expect(screen.getByText('Test issue')).toBeInTheDocument();
  });

  it('renders loading indicator', () => {
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [],
      defaults: mockDefaults,
      loading: true,
      error: null,
      dispatching: false,
      refresh: vi.fn(),
      dispatch: vi.fn(),
    });
    render(<DispatcherView />);
    expect(screen.getByText('Loading dispatch queue...')).toBeInTheDocument();
  });

  it('renders error message', () => {
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [],
      defaults: mockDefaults,
      loading: false,
      error: 'Something broke',
      dispatching: false,
      refresh: vi.fn(),
      dispatch: vi.fn(),
    });
    render(<DispatcherView />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [],
      defaults: mockDefaults,
      loading: false,
      error: null,
      dispatching: false,
      refresh: vi.fn(),
      dispatch: vi.fn(),
    });
    render(<DispatcherView />);
    expect(screen.getByText('No issues ready for dispatch')).toBeInTheDocument();
  });

  it('renders queue count', () => {
    render(<DispatcherView />);
    expect(screen.getByText('1 ready')).toBeInTheDocument();
  });

  it('renders select all and clear buttons', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('renders priority and estimate', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('3pt')).toBeInTheDocument();
  });

  it('renders phase name', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Phase 1')).toBeInTheDocument();
  });

  it('renders system prompt textarea when queue has items', () => {
    render(<DispatcherView />);
    expect(screen.getByText('System Prompt (optional)')).toBeInTheDocument();
  });

  it('renders model dropdown from config', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByText('Opus 4.6')).toBeInTheDocument();
  });

  it('renders saga group header', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Test Saga')).toBeInTheDocument();
  });

  it('selects all and clears selection', () => {
    render(<DispatcherView />);
    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('toggles individual item selection', () => {
    render(<DispatcherView />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('shows dispatch button disabled when nothing selected', () => {
    render(<DispatcherView />);
    const btn = screen.getByText('Dispatch 0');
    expect(btn).toBeDisabled();
  });

  it('dispatches and shows results', async () => {
    const mockDispatch = vi
      .fn()
      .mockResolvedValue([{ issue_id: 'i1', session_name: 'niu-100', status: 'spawned' }]);
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [
        {
          saga_id: 's1',
          saga_name: 'Test Saga',
          saga_slug: 'test',
          repos: ['https://github.com/org/repo'],
          feature_branch: 'feat/test',
          phase_name: 'Phase 1',
          issue_id: 'i1',
          identifier: 'NIU-100',
          title: 'Test issue',
          description: '',
          status: 'Todo',
          priority: 1,
          priority_label: 'Urgent',
          estimate: 3,
          url: '',
        },
      ],
      defaults: mockDefaults,
      loading: false,
      error: null,
      dispatching: false,
      refresh: vi.fn(),
      dispatch: mockDispatch,
    });
    render(<DispatcherView />);
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Dispatch 1'));
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText(/niu-100/)).toBeInTheDocument();
    });
    // Dismiss results
    fireEvent.click(screen.getByText('Dismiss'));
  });

  it('shows dispatching state', () => {
    vi.mocked(useDispatchQueue).mockReturnValue({
      queue: [
        {
          saga_id: 's1',
          saga_name: 'Test Saga',
          saga_slug: 'test',
          repos: ['https://github.com/org/repo'],
          feature_branch: 'feat/test',
          phase_name: 'Phase 1',
          issue_id: 'i1',
          identifier: 'NIU-100',
          title: 'Test issue',
          description: '',
          status: 'Todo',
          priority: 1,
          priority_label: 'Urgent',
          estimate: 3,
          url: '',
        },
      ],
      defaults: mockDefaults,
      loading: false,
      error: null,
      dispatching: true,
      refresh: vi.fn(),
      dispatch: vi.fn(),
    });
    render(<DispatcherView />);
    expect(screen.getByText('Dispatching...')).toBeInTheDocument();
  });
});
