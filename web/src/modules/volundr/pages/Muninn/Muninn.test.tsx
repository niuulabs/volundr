import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MuninnPage } from './index';

vi.mock('@/modules/volundr/hooks/useMemories', () => ({
  useMemories: vi.fn(),
}));

import { useMemories } from '@/modules/volundr/hooks/useMemories';

const mockMemories = [
  {
    id: 'mem-1',
    type: 'preference',
    content: 'User prefers functional components over class components in React',
    confidence: 0.92,
    usageCount: 48,
    lastUsed: '2024-01-20',
  },
  {
    id: 'mem-2',
    type: 'pattern',
    content: 'When migrating storage, always create backup first and run in phases',
    confidence: 0.88,
    usageCount: 23,
    lastUsed: '2024-01-19',
  },
  {
    id: 'mem-3',
    type: 'outcome',
    content: 'Adding derivative filtering improved thermal stability by 40%',
    confidence: 0.95,
    usageCount: 12,
    lastUsed: '2024-01-18',
  },
];

const mockStats = {
  totalMemories: 156,
  preferences: 42,
  patterns: 67,
  outcomes: 47,
};

describe('MuninnPage', () => {
  const searchMemories = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    searchMemories.mockResolvedValue([]);
  });

  it('shows loading state when loading', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: [],
      stats: null,
      loading: true,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText('Muninn')).toBeInTheDocument();
    expect(
      screen.getByText('Long-term memory — patterns, preferences, outcomes')
    ).toBeInTheDocument();
  });

  it('renders search input', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByPlaceholderText('Search memories...')).toBeInTheDocument();
  });

  it('renders metrics cards with stats', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText('Total Memories')).toBeInTheDocument();
    expect(screen.getAllByText('156').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Patterns')).toBeInTheDocument();
    expect(screen.getAllByText('67').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Outcomes')).toBeInTheDocument();
    // 47 appears both as outcomes stat and accessCount in memory
    expect(screen.getAllByText('47').length).toBeGreaterThanOrEqual(1);
  });

  it('renders memory cards', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    // Memory content is displayed
    expect(screen.getByText(/User prefers functional components/)).toBeInTheDocument();
    expect(screen.getByText(/When migrating storage/)).toBeInTheDocument();
    expect(screen.getByText(/Adding derivative filtering/)).toBeInTheDocument();
  });

  it('renders stored memories section title', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText('Stored Memories')).toBeInTheDocument();
  });

  it('renders learning section', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText('Feedback & Learning')).toBeInTheDocument();
    expect(screen.getByText('How ODIN Learns')).toBeInTheDocument();
  });

  it('renders learning feedback types', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText(/Explicit feedback/)).toBeInTheDocument();
    expect(screen.getByText(/Corrections/)).toBeInTheDocument();
    expect(screen.getByText(/Implicit signals/)).toBeInTheDocument();
    expect(screen.getByText(/Calibration/)).toBeInTheDocument();
  });

  it('renders monthly summary', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    expect(screen.getByText("This Month's Summary")).toBeInTheDocument();
    expect(screen.getByText('Autonomous tasks')).toBeInTheDocument();
    expect(screen.getByText('Successful')).toBeInTheDocument();
    expect(screen.getByText('Rolled back')).toBeInTheDocument();
  });

  it('calls searchMemories when search input changes', async () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);

    const searchInput = screen.getByPlaceholderText('Search memories...');
    fireEvent.change(searchInput, { target: { value: 'storage' } });

    await waitFor(() => {
      expect(searchMemories).toHaveBeenCalledWith('storage');
    });
  });

  it('displays search results when available', async () => {
    const searchResults = [mockMemories[1]];
    searchMemories.mockResolvedValue(searchResults);

    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);

    const searchInput = screen.getByPlaceholderText('Search memories...');
    fireEvent.change(searchInput, { target: { value: 'storage' } });

    await waitFor(() => {
      expect(screen.getByText(/When migrating storage/)).toBeInTheDocument();
    });
  });

  it('clears search results when search query is emptied', async () => {
    searchMemories.mockResolvedValue([mockMemories[1]]);

    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: mockStats,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);

    const searchInput = screen.getByPlaceholderText('Search memories...');

    // Search for something
    fireEvent.change(searchInput, { target: { value: 'storage' } });

    await waitFor(() => {
      expect(searchMemories).toHaveBeenCalledWith('storage');
    });

    // Clear the search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Should show all memories again (the first mock memory)
    await waitFor(() => {
      expect(screen.getByText(/User prefers functional/)).toBeInTheDocument();
    });
  });

  it('handles null stats gracefully', () => {
    vi.mocked(useMemories).mockReturnValue({
      memories: mockMemories,
      stats: null,
      loading: false,
      error: null,
      searchMemories,
    });

    render(<MuninnPage />);
    // Should render 0 values when stats are null (may appear multiple times)
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });
});
