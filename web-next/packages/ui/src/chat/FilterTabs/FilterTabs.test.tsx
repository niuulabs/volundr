import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterTabs } from './FilterTabs';

vi.mock('./FilterTabs.module.css', () => ({ default: {} }));

describe('FilterTabs', () => {
  const options = ['all', 'open', 'closed'];

  it('renders all options as buttons', () => {
    render(<FilterTabs options={options} value="all" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'closed' })).toBeInTheDocument();
  });

  it('calls onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<FilterTabs options={options} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(onChange).toHaveBeenCalledWith('open');
  });

  it('calls onChange with the correct option value', () => {
    const onChange = vi.fn();
    render(<FilterTabs options={options} value="open" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'closed' }));
    expect(onChange).toHaveBeenCalledWith('closed');
  });

  it('uses custom renderOption when provided', () => {
    const renderOption = (opt: string) => <span data-testid={`custom-${opt}`}>{opt.toUpperCase()}</span>;
    render(<FilterTabs options={['a', 'b']} value="a" onChange={vi.fn()} renderOption={renderOption} />);
    expect(screen.getByTestId('custom-a')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders option text directly when no renderOption provided', () => {
    render(<FilterTabs options={['foo']} value="foo" onChange={vi.fn()} />);
    expect(screen.getByText('foo')).toBeInTheDocument();
  });

  it('renders an empty list when options is empty', () => {
    const { container } = render(<FilterTabs options={[]} value="" onChange={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(0);
  });
});
