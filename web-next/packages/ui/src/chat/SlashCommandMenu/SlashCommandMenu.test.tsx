import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SlashCommand } from '../types';

vi.mock('./SlashCommandMenu.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  Slash: () => <span>Slash</span>,
  Hammer: () => <span>Hammer</span>,
}));

const commands: SlashCommand[] = [
  { name: 'init', type: 'command' },
  { name: 'deploy', type: 'command' },
  { name: 'review', type: 'skill' },
];

describe('SlashCommandMenu', () => {
  it('renders list of commands', () => {
    render(<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={vi.fn()} />);
    expect(screen.getByText('/init')).toBeInTheDocument();
    expect(screen.getByText('/deploy')).toBeInTheDocument();
    expect(screen.getByText('/review')).toBeInTheDocument();
  });

  it('shows type badges', () => {
    render(<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={vi.fn()} />);
    const commandBadges = screen.getAllByText('command');
    expect(commandBadges).toHaveLength(2);
    expect(screen.getByText('skill')).toBeInTheDocument();
  });

  it('shows "No matching commands" when commands list is empty', () => {
    render(<SlashCommandMenu commands={[]} selectedIndex={0} onSelect={vi.fn()} />);
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('calls onSelect when a command button is clicked', () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('/init'));
    expect(onSelect).toHaveBeenCalledWith(commands[0]);
  });

  it('calls onSelect with the correct command', () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('/deploy'));
    expect(onSelect).toHaveBeenCalledWith(commands[1]);
  });

  it('marks selected item with data-selected="true"', () => {
    render(<SlashCommandMenu commands={commands} selectedIndex={1} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('data-selected', 'true');
  });

  it('marks non-selected items with data-selected="false"', () => {
    render(<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('data-selected', 'false');
  });
});
