import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatcherView } from './DispatcherView';

vi.mock('../../hooks', () => ({
  useDispatcher: () => ({
    state: {
      id: 'disp-1',
      running: true,
      threshold: 0.85,
      updated_at: '2026-01-01T00:00:00Z',
    },
    log: ['[12:00] Dispatched raid-1', '[12:01] Raid-1 completed'],
    loading: false,
    error: null,
    pause: vi.fn(),
    resume: vi.fn(),
    setThreshold: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('DispatcherView', () => {
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
});
