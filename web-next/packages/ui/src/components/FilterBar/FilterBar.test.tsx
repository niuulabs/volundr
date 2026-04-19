import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  FilterBar,
  FilterChip,
  FilterToggle,
  serializeFilters,
  deserializeFilters,
} from './FilterBar';

describe('FilterBar', () => {
  it('renders search input with placeholder', () => {
    render(
      <FilterBar searchValue="" onSearchChange={vi.fn()} searchPlaceholder="Find sessions…" />,
    );
    expect(screen.getByPlaceholderText('Find sessions…')).toBeInTheDocument();
  });

  it('calls onSearchChange when typing', () => {
    const onSearchChange = vi.fn();
    render(<FilterBar searchValue="" onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'abc' } });
    expect(onSearchChange).toHaveBeenCalledWith('abc');
  });

  it('shows clear button when searchValue is non-empty', () => {
    render(<FilterBar searchValue="hello" onSearchChange={vi.fn()} />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('clear button calls onSearchChange with empty string', () => {
    const onSearchChange = vi.fn();
    render(<FilterBar searchValue="hello" onSearchChange={onSearchChange} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('hides search when onSearchChange not provided', () => {
    render(<FilterBar />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('renders children in chips area', () => {
    render(
      <FilterBar>
        <span data-testid="chip">chip</span>
      </FilterBar>,
    );
    expect(screen.getByTestId('chip')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(<FilterBar actions={<button>Export</button>} />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });
});

describe('FilterChip', () => {
  it('renders label', () => {
    render(<FilterChip label="status" onRemove={vi.fn()} />);
    expect(screen.getByText('status')).toBeInTheDocument();
  });

  it('renders value when provided', () => {
    render(<FilterChip label="status" value="running" onRemove={vi.fn()} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('calls onRemove when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<FilterChip label="status" onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove filter: status'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('FilterToggle', () => {
  it('renders label', () => {
    render(<FilterToggle label="Pinned" active={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('has aria-pressed matching active prop', () => {
    render(<FilterToggle label="Pinned" active={true} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onToggle with toggled value', () => {
    const onToggle = vi.fn();
    render(<FilterToggle label="Pinned" active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('calls onToggle with false when active', () => {
    const onToggle = vi.fn();
    render(<FilterToggle label="Pinned" active={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('applies active class', () => {
    render(<FilterToggle label="Pinned" active={true} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('niuu-filter-toggle--active');
  });
});

describe('serializeFilters', () => {
  it('omits undefined values', () => {
    expect(serializeFilters({ a: undefined })).toEqual({});
  });

  it('omits false boolean values', () => {
    expect(serializeFilters({ a: false })).toEqual({});
  });

  it('omits empty string values', () => {
    expect(serializeFilters({ a: '' })).toEqual({});
  });

  it('omits empty arrays', () => {
    expect(serializeFilters({ a: [] })).toEqual({});
  });

  it('serializes true to string', () => {
    expect(serializeFilters({ pinned: true })).toEqual({ pinned: 'true' });
  });

  it('passes through non-empty strings', () => {
    expect(serializeFilters({ q: 'hello' })).toEqual({ q: 'hello' });
  });

  it('passes through non-empty arrays', () => {
    expect(serializeFilters({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] });
  });
});

describe('deserializeFilters', () => {
  it('passes through string values', () => {
    expect(deserializeFilters({ q: 'hello' })).toEqual({ q: 'hello' });
  });

  it('omits undefined values', () => {
    expect(deserializeFilters({ q: undefined })).toEqual({});
  });

  it('passes through arrays', () => {
    expect(deserializeFilters({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] });
  });
});
