import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LinearIssue } from '@/models';
import { LinearIssueSearch } from './LinearIssueSearch';

const mockIssues: LinearIssue[] = [
  {
    id: 'lin-001',
    identifier: 'NIU-44',
    title: 'Implement thermal calibration PID improvements',
    status: 'in_progress',
    assignee: 'Jozef',
    labels: ['firmware'],
    priority: 2,
    url: 'https://linear.app/niuu/issue/NIU-44',
  },
  {
    id: 'lin-002',
    identifier: 'NIU-45',
    title: 'Add Huginn reflex layer',
    status: 'todo',
    priority: 1,
    url: 'https://linear.app/niuu/issue/NIU-45',
  },
];

describe('LinearIssueSearch', () => {
  const mockOnSelect = vi.fn();
  const mockOnClear = vi.fn();
  const mockOnSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSearch.mockResolvedValue(mockIssues);
  });

  it('renders search input when no issue selected', () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
      />
    );
    expect(screen.getByPlaceholderText(/search linear issues/i)).toBeInTheDocument();
  });

  it('shows dropdown results when typing', async () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
      />
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    fireEvent.change(input, { target: { value: 'NIU' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(mockOnSearch).toHaveBeenCalledWith('NIU');
    });

    await waitFor(() => {
      expect(screen.getByText('NIU-44')).toBeInTheDocument();
      expect(screen.getByText('NIU-45')).toBeInTheDocument();
    });
  });

  it('calls onSelect when clicking a result', async () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
      />
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    fireEvent.change(input, { target: { value: 'NIU' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('NIU-44')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('NIU-44'));
    expect(mockOnSelect).toHaveBeenCalledWith(mockIssues[0]);
  });

  it('shows selected issue when one is set', () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={mockIssues[0]}
        onSearch={mockOnSearch}
      />
    );

    expect(screen.getByText('NIU-44')).toBeInTheDocument();
    expect(screen.getByText('Implement thermal calibration PID improvements')).toBeInTheDocument();
  });

  it('calls onClear when clearing selected issue', () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={mockIssues[0]}
        onSearch={mockOnSearch}
      />
    );

    fireEvent.click(screen.getByLabelText('Clear selected issue'));
    expect(mockOnClear).toHaveBeenCalled();
  });

  it('disables input when disabled prop is true', () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
        disabled={true}
      />
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    expect(input).toBeDisabled();
  });

  it('does not search with less than 2 characters', async () => {
    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
      />
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    fireEvent.change(input, { target: { value: 'N' } });

    // Wait a bit for the debounce
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(mockOnSearch).not.toHaveBeenCalled();
  });

  it('closes dropdown when clicking outside', async () => {
    render(
      <div>
        <LinearIssueSearch
          onSelect={mockOnSelect}
          onClear={mockOnClear}
          selectedIssue={null}
          onSearch={mockOnSearch}
        />
        <div data-testid="outside">Outside</div>
      </div>
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    fireEvent.change(input, { target: { value: 'NIU' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('NIU-44')).toBeInTheDocument();
    });

    // Click outside the component
    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByText('NIU-44')).not.toBeInTheDocument();
    });
  });

  it('shows no results message when search returns empty', async () => {
    mockOnSearch.mockResolvedValue([]);

    render(
      <LinearIssueSearch
        onSelect={mockOnSelect}
        onClear={mockOnClear}
        selectedIssue={null}
        onSearch={mockOnSearch}
      />
    );

    const input = screen.getByPlaceholderText(/search linear issues/i);
    fireEvent.change(input, { target: { value: 'xyz' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeInTheDocument();
    });
  });
});
