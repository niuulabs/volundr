import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffBaseToggle } from './DiffBaseToggle';

describe('DiffBaseToggle', () => {
  it('renders both toggle options', () => {
    render(<DiffBaseToggle value="last-commit" onChange={vi.fn()} />);

    expect(screen.getByText('Last Commit')).toBeDefined();
    expect(screen.getByText('Default Branch')).toBeDefined();
  });

  it('marks the active option', () => {
    const { container } = render(<DiffBaseToggle value="last-commit" onChange={vi.fn()} />);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].className).toContain('optionActive');
    expect(buttons[1].className).not.toContain('optionActive');
  });

  it('marks default-branch as active', () => {
    const { container } = render(<DiffBaseToggle value="default-branch" onChange={vi.fn()} />);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].className).not.toContain('optionActive');
    expect(buttons[1].className).toContain('optionActive');
  });

  it('calls onChange when clicking an option', () => {
    const onChange = vi.fn();
    render(<DiffBaseToggle value="last-commit" onChange={onChange} />);

    fireEvent.click(screen.getByText('Default Branch'));
    expect(onChange).toHaveBeenCalledWith('default-branch');
  });

  it('calls onChange with last-commit when clicking first option', () => {
    const onChange = vi.fn();
    render(<DiffBaseToggle value="default-branch" onChange={onChange} />);

    fireEvent.click(screen.getByText('Last Commit'));
    expect(onChange).toHaveBeenCalledWith('last-commit');
  });

  it('applies custom className', () => {
    const { container } = render(
      <DiffBaseToggle value="last-commit" onChange={vi.fn()} className="custom" />
    );

    expect(container.firstChild?.className).toContain('custom');
  });
});
