import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChroniclePage } from './index';

vi.mock('@/modules/volundr/hooks/useChronicle', () => ({
  useChronicle: vi.fn(),
}));

import { useChronicle } from '@/modules/volundr/hooks/useChronicle';

const mockEntries = [
  {
    type: 'think',
    time: '14:23:45',
    message: 'Analyzing storage migration patterns',
    agent: 'odin',
  },
  {
    type: 'observe',
    time: '14:23:40',
    message: 'Detected high memory usage on api-gateway pod',
    agent: 'brunhilde',
  },
  { type: 'decide', time: '14:23:35', message: 'Approved PR #47 for merge', agent: 'odin' },
  { type: 'act', time: '14:23:30', message: 'Merged PR #47 to main branch', agent: 'odin' },
  {
    type: 'complete',
    time: '14:23:25',
    message: 'Storage migration phase 1 complete',
    agent: 'skuld-alpha',
  },
  { type: 'merge', time: '14:23:20', message: 'Merged feature/storage-adapter', agent: 'github' },
];

describe('ChroniclePage', () => {
  const setFilter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when loading', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: [],
      filter: 'all',
      setFilter,
      loading: true,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.getByText('Chronicle')).toBeInTheDocument();
    expect(
      screen.getByText("Complete log of ODIN's observations, thoughts, and actions")
    ).toBeInTheDocument();
  });

  it('renders filter tabs', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    // Filter tabs - types also appear in entries so use getAllByText
    expect(screen.getAllByText('all').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('think').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('observe').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('decide').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('act').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('complete').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('merge').length).toBeGreaterThanOrEqual(1);
  });

  it('renders all chronicle entries', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.getByText('Analyzing storage migration patterns')).toBeInTheDocument();
    expect(screen.getByText('Detected high memory usage on api-gateway pod')).toBeInTheDocument();
    expect(screen.getByText('Approved PR #47 for merge')).toBeInTheDocument();
    expect(screen.getByText('Merged PR #47 to main branch')).toBeInTheDocument();
    expect(screen.getByText('Storage migration phase 1 complete')).toBeInTheDocument();
    expect(screen.getByText('Merged feature/storage-adapter')).toBeInTheDocument();
  });

  it('calls setFilter when filter tab clicked', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);

    // Click on first 'think' element (the filter tab)
    const thinkElements = screen.getAllByText('think');
    fireEvent.click(thinkElements[0]);

    expect(setFilter).toHaveBeenCalledWith('think');
  });

  it('shows active state on current filter', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'think',
      setFilter,
      loading: false,
      error: null,
    });

    const { container } = render(<ChroniclePage />);
    const activeTab = container.querySelector('[class*="active"]');
    expect(activeTab).toHaveTextContent('think');
  });

  it('shows empty state when no entries match filter', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: [],
      filter: 'think',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.getByText('No entries match the filter')).toBeInTheDocument();
  });

  it('does not show empty state when entries exist', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.queryByText('No entries match the filter')).not.toBeInTheDocument();
  });

  it('renders entry times', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    render(<ChroniclePage />);
    expect(screen.getByText('14:23:45')).toBeInTheDocument();
    expect(screen.getByText('14:23:40')).toBeInTheDocument();
  });

  it('renders entries in a list', () => {
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockEntries,
      filter: 'all',
      setFilter,
      loading: false,
      error: null,
    });

    const { container } = render(<ChroniclePage />);
    const entriesList = container.querySelector('[class*="entries"]');
    expect(entriesList).toBeInTheDocument();
  });
});
