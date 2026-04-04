import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DispatcherSettingsSection } from './DispatcherSettingsSection';

const mockSetAutoContinue = vi.fn();
const mockState = {
  id: 'disp-1',
  running: true,
  threshold: 0.75,
  max_concurrent_raids: 3,
  auto_continue: false,
  updated_at: '2026-03-21T08:00:00Z',
};

vi.mock('@/modules/tyr/hooks/useDispatcher', () => ({
  useDispatcher: vi.fn(() => ({
    state: mockState,
    log: [],
    loading: false,
    error: null,
    pause: vi.fn(),
    resume: vi.fn(),
    setThreshold: vi.fn(),
    setAutoContinue: mockSetAutoContinue,
    refresh: vi.fn(),
  })),
}));

const { useDispatcher } = await import('@/modules/tyr/hooks/useDispatcher');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DispatcherSettingsSection', () => {
  it('renders the section title', () => {
    render(<DispatcherSettingsSection />);
    expect(screen.getByText('Dispatcher')).toBeInTheDocument();
  });

  it('renders auto-continue toggle in off state', () => {
    render(<DispatcherSettingsSection />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('calls setAutoContinue when toggle is clicked', async () => {
    render(<DispatcherSettingsSection />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockSetAutoContinue).toHaveBeenCalledWith(true);
    });
  });

  it('renders toggle in on state when auto_continue is true', () => {
    vi.mocked(useDispatcher).mockReturnValue({
      state: { ...mockState, auto_continue: true },
      log: [],
      loading: false,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      setAutoContinue: mockSetAutoContinue,
      refresh: vi.fn(),
    });
    render(<DispatcherSettingsSection />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows loading state', () => {
    vi.mocked(useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: true,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      setAutoContinue: vi.fn(),
      refresh: vi.fn(),
    });
    render(<DispatcherSettingsSection />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows error state', () => {
    vi.mocked(useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: false,
      error: 'Connection failed',
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      setAutoContinue: vi.fn(),
      refresh: vi.fn(),
    });
    render(<DispatcherSettingsSection />);
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('renders nothing when state is null and not loading', () => {
    vi.mocked(useDispatcher).mockReturnValue({
      state: null,
      log: [],
      loading: false,
      error: null,
      pause: vi.fn(),
      resume: vi.fn(),
      setThreshold: vi.fn(),
      setAutoContinue: vi.fn(),
      refresh: vi.fn(),
    });
    const { container } = render(<DispatcherSettingsSection />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the setting description', () => {
    render(<DispatcherSettingsSection />);
    expect(
      screen.getByText('Automatically dispatch newly unblocked raids after merge')
    ).toBeInTheDocument();
  });
});
