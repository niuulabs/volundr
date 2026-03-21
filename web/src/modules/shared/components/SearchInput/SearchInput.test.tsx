import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchInput } from './SearchInput';

describe('SearchInput', () => {
  it('renders with default placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} />);

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Find memories..." />);

    expect(screen.getByPlaceholderText('Find memories...')).toBeInTheDocument();
  });

  it('displays current value', () => {
    render(<SearchInput value="test query" onChange={() => {}} />);

    expect(screen.getByDisplayValue('test query')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const handleChange = vi.fn();
    render(<SearchInput value="" onChange={handleChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new value' } });

    expect(handleChange).toHaveBeenCalledWith('new value');
  });

  it('renders search icon', () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <SearchInput value="" onChange={() => {}} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('handles empty string value', () => {
    render(<SearchInput value="" onChange={() => {}} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');
  });

  it('handles special characters in value', () => {
    render(<SearchInput value="test@#$%^&*()" onChange={() => {}} />);

    expect(screen.getByDisplayValue('test@#$%^&*()')).toBeInTheDocument();
  });

  it('updates when value prop changes', () => {
    const { rerender } = render(<SearchInput value="first" onChange={() => {}} />);

    expect(screen.getByDisplayValue('first')).toBeInTheDocument();

    rerender(<SearchInput value="second" onChange={() => {}} />);

    expect(screen.getByDisplayValue('second')).toBeInTheDocument();
  });
});
