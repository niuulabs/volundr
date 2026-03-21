import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DispatcherView } from './DispatcherView';
import * as hooks from '../../hooks';

vi.mock('../../hooks', () => ({
  useDispatcher: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ label }: { label?: string }) => (
    <div data-testid="loading-indicator">{label}</div>
  ),
}));

const mockPause = vi.fn();
const mockResume = vi.fn();
const mockSetThreshold = vi.fn();

describe('DispatcherView', () => {
  beforeEach(() => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: {
        id: 'disp-1',
        running: true,
        threshold: 0.85,
        updated_at: '2026-01-01T00:00:00Z',
      },
      log: ['[12:00] Dispatched raid-1', '[12:01] Raid-1 completed'],
      loading: false,
      error: null,
      pause: mockPause,
      resume: mockResume,
      setThreshold: mockSetThreshold,
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);
  });

  it('renders dispatcher running status', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders pause button when running', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
  });

  it('renders threshold value', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Confidence Threshold: 85%')).toBeInTheDocument();
  });

  it('renders log entries', () => {
    render(<DispatcherView />);
    expect(screen.getByText('[12:00] Dispatched raid-1')).toBeInTheDocument();
    expect(screen.getByText('[12:01] Raid-1 completed')).toBeInTheDocument();
  });

  it('renders log heading', () => {
    render(<DispatcherView />);
    expect(screen.getByText('Dispatcher Log')).toBeInTheDocument();
  });

  it('renders loading indicator when loading', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: true,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    expect(screen.getByText('Loading dispatcher...')).toBeInTheDocument();
  });

  it('renders error message when error occurs', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: false,
      error: 'Connection failed',
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('renders empty state when state is null', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: false,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    expect(screen.getByText('Dispatcher not available')).toBeInTheDocument();
  });

  it('renders resume button and paused status when not running', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: {
        id: 'disp-1',
        running: false,
        threshold: 0.5,
        updated_at: '2026-01-01T00:00:00Z',
      },
      log: [],
      loading: false,
      error: null,
      pause: mockPause,
      resume: mockResume,
      setThreshold: mockSetThreshold,
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Resume')).toBeInTheDocument();
  });

  it('calls pause when clicking pause button while running', () => {
    render(<DispatcherView />);
    fireEvent.click(screen.getByText('Pause'));
    expect(mockPause).toHaveBeenCalled();
  });

  it('calls resume when clicking resume button while paused', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: {
        id: 'disp-1',
        running: false,
        threshold: 0.5,
        updated_at: '2026-01-01T00:00:00Z',
      },
      log: [],
      loading: false,
      error: null,
      pause: mockPause,
      resume: mockResume,
      setThreshold: mockSetThreshold,
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    fireEvent.click(screen.getByText('Resume'));
    expect(mockResume).toHaveBeenCalled();
  });

  it('calls setThreshold when changing range input', () => {
    render(<DispatcherView />);
    const range = screen.getByLabelText(/Confidence Threshold/);
    fireEvent.change(range, { target: { value: '50' } });
    expect(mockSetThreshold).toHaveBeenCalledWith(0.5);
  });

  it('renders empty log message when log is empty', () => {
    vi.mocked(hooks.useDispatcher).mockReturnValue({
      state: {
        id: 'disp-1',
        running: true,
        threshold: 0.85,
        updated_at: '2026-01-01T00:00:00Z',
      },
      log: [],
      loading: false,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useDispatcher>);

    render(<DispatcherView />);
    expect(screen.getByText('No log entries')).toBeInTheDocument();
  });
});
