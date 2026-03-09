import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SlashCommand } from './slashCommands';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const testCommands: SlashCommand[] = [
  { name: 'help', type: 'command', description: 'Show help' },
  { name: 'clear', type: 'command', description: 'Clear chat' },
  { name: 'simplify', type: 'skill', description: 'Simplify code' },
];

describe('SlashCommandMenu', () => {
  it('renders all provided commands', () => {
    render(<SlashCommandMenu selectedIndex={0} commands={testCommands} onSelect={vi.fn()} />);

    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByText('/clear')).toBeInTheDocument();
    expect(screen.getByText('/simplify')).toBeInTheDocument();
  });

  it('shows empty state when commands list is empty', () => {
    render(<SlashCommandMenu selectedIndex={0} commands={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('calls onSelect when command is clicked', () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu selectedIndex={0} commands={testCommands} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('/help'));
    expect(onSelect).toHaveBeenCalledWith(testCommands[0]);
  });

  it('shows type badge for each command', () => {
    render(<SlashCommandMenu selectedIndex={0} commands={testCommands} onSelect={vi.fn()} />);

    expect(screen.getAllByText('command')).toHaveLength(2);
    expect(screen.getByText('skill')).toBeInTheDocument();
  });

  it('marks selected item with data-selected', () => {
    render(<SlashCommandMenu selectedIndex={1} commands={testCommands} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0].getAttribute('data-selected')).toBe('false');
    expect(buttons[1].getAttribute('data-selected')).toBe('true');
    expect(buttons[2].getAttribute('data-selected')).toBe('false');
  });
});
