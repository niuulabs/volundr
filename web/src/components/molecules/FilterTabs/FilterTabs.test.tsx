import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterTabs } from './FilterTabs';

describe('FilterTabs', () => {
  const defaultOptions = ['all', 'active', 'pending', 'complete'];

  it('renders all options', () => {
    render(<FilterTabs options={defaultOptions} value="all" onChange={() => {}} />);

    for (const option of defaultOptions) {
      expect(screen.getByText(option)).toBeInTheDocument();
    }
  });

  it('applies active style to selected option', () => {
    render(<FilterTabs options={defaultOptions} value="active" onChange={() => {}} />);

    const activeButton = screen.getByText('active');
    expect(activeButton.className).toMatch(/active/);
  });

  it('calls onChange when option is clicked', () => {
    const handleChange = vi.fn();
    render(<FilterTabs options={defaultOptions} value="all" onChange={handleChange} />);

    fireEvent.click(screen.getByText('pending'));
    expect(handleChange).toHaveBeenCalledWith('pending');
  });

  it('does not apply active style to non-selected options', () => {
    render(<FilterTabs options={defaultOptions} value="all" onChange={() => {}} />);

    const nonActiveButtons = ['active', 'pending', 'complete'].map(opt => screen.getByText(opt));

    for (const button of nonActiveButtons) {
      expect(button).not.toHaveClass('active');
    }
  });

  it('applies custom className', () => {
    const { container } = render(
      <FilterTabs
        options={defaultOptions}
        value="all"
        onChange={() => {}}
        className="custom-class"
      />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders with single option', () => {
    render(<FilterTabs options={['only']} value="only" onChange={() => {}} />);

    expect(screen.getByText('only')).toBeInTheDocument();
  });

  it('handles rapid clicks', () => {
    const handleChange = vi.fn();
    render(<FilterTabs options={defaultOptions} value="all" onChange={handleChange} />);

    fireEvent.click(screen.getByText('active'));
    fireEvent.click(screen.getByText('pending'));
    fireEvent.click(screen.getByText('complete'));

    expect(handleChange).toHaveBeenCalledTimes(3);
    expect(handleChange).toHaveBeenNthCalledWith(1, 'active');
    expect(handleChange).toHaveBeenNthCalledWith(2, 'pending');
    expect(handleChange).toHaveBeenNthCalledWith(3, 'complete');
  });

  it('renders empty options array', () => {
    const { container } = render(<FilterTabs options={[]} value="" onChange={() => {}} />);

    expect(container.firstChild).toBeEmptyDOMElement();
  });
});
