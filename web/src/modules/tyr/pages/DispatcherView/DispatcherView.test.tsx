import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('renders model dropdown from config', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByText('Opus 4.6')).toBeInTheDocument();
  });

  it('renders saga group header', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Test Saga')).toBeInTheDocument();
  });
});
