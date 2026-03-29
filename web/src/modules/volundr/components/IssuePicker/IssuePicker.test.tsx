import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssuePicker } from './IssuePicker';

const mockSearchIssues = vi.fn();
const mockIssues: {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee: null;
  labels: string[];
  priority: number;
  url: string;
}[] = [];
let mockLoading = false;

vi.mock('@/modules/volundr/hooks/useIssues', () => ({
  useIssues: () => ({
    issues: mockIssues,
    loading: mockLoading,
    error: null,
    searchIssues: mockSearchIssues,
    getIssue: vi.fn(),
  }),
}));

const sampleIssue = {
  id: '1',
  identifier: 'NIU-42',
  title: 'Fix auth bug',
  status: 'In Progress',
  assignee: null,
  labels: [] as string[],
  priority: 1,
  url: 'https://linear.app/NIU-42',
};

describe('IssuePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIssues.length = 0;
    mockLoading = false;
    mockSearchIssues.mockClear();
  });

  it('renders search input when no issue selected', () => {
    render(<IssuePicker onSelect={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search issues...')).toBeInTheDocument();
  });

  it('renders selected issue with clear button', () => {
    const onClear = vi.fn();
    render(<IssuePicker onSelect={vi.fn()} onClear={onClear} selectedIssue={sampleIssue} />);

    expect(screen.getByText('NIU-42')).toBeInTheDocument();
    expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    fireEvent.click(screen.getByText('\u00d7'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders selected issue without clear button when onClear not provided', () => {
    render(<IssuePicker onSelect={vi.fn()} selectedIssue={sampleIssue} />);
    expect(screen.getByText('NIU-42')).toBeInTheDocument();
    expect(screen.queryByText('\u00d7')).not.toBeInTheDocument();
  });

  it('debounces search on input change with 2+ chars', () => {
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'au' } });
    expect(mockSearchIssues).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSearchIssues).toHaveBeenCalledWith('au');
  });

  it('does not search for input shorter than 2 chars', () => {
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'a' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSearchIssues).not.toHaveBeenCalled();
  });

  it('clears previous debounce on rapid typing', () => {
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'au' } });
    fireEvent.change(input, { target: { value: 'auth' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSearchIssues).toHaveBeenCalledTimes(1);
    expect(mockSearchIssues).toHaveBeenCalledWith('auth');
  });

  it('shows loading state in dropdown', () => {
    mockLoading = true;
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'test' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('shows no issues found when search returns empty', () => {
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'test' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('shows issues in dropdown and handles select', () => {
    mockIssues.push(sampleIssue);
    const onSelect = vi.fn();
    render(<IssuePicker onSelect={onSelect} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'auth' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByText('Fix auth bug'));
    expect(onSelect).toHaveBeenCalledWith(sampleIssue);
  });

  it('opens dropdown on focus when issues exist and query is long enough', () => {
    mockIssues.push(sampleIssue);
    render(<IssuePicker onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search issues...');

    fireEvent.change(input, { target: { value: 'au' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.focus(input);
    expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
  });
});
