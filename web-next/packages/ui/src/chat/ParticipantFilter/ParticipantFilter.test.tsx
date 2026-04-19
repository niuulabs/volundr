import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParticipantFilter } from './ParticipantFilter';
import type { RoomParticipant } from '../types';

vi.mock('./ParticipantFilter.module.css', () => ({ default: {} }));
vi.mock('../FilterTabs/FilterTabs.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  Eye: () => <span>Eye</span>,
  EyeOff: () => <span>EyeOff</span>,
}));

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: 'Alpha',
    color: 'p1',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

describe('ParticipantFilter', () => {
  const participants = new Map([
    ['peer-1', makeParticipant({ peerId: 'peer-1', persona: 'Alpha', displayName: '' })],
    ['peer-2', makeParticipant({ peerId: 'peer-2', persona: 'Beta', displayName: '' })],
  ]);

  it('renders "All" option', () => {
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={false}
        onToggleInternal={vi.fn()}
      />
    );
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders each participant persona', () => {
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={false}
        onToggleInternal={vi.fn()}
      />
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('clicking a participant option calls onFilterChange with peerId', () => {
    const onFilterChange = vi.fn();
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={onFilterChange}
        showInternal={false}
        onToggleInternal={vi.fn()}
      />
    );
    // The FilterTabs renders buttons for each option
    const alphaBtn = screen.getByText('Alpha').closest('button') ?? screen.getByText('Alpha');
    fireEvent.click(alphaBtn);
    expect(onFilterChange).toHaveBeenCalledWith('peer-1');
  });

  it('clicking "All" calls onFilterChange with "all"', () => {
    const onFilterChange = vi.fn();
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="peer-1"
        onFilterChange={onFilterChange}
        showInternal={false}
        onToggleInternal={vi.fn()}
      />
    );
    const allBtn = screen.getByText('All').closest('button') ?? screen.getByText('All');
    fireEvent.click(allBtn);
    expect(onFilterChange).toHaveBeenCalledWith('all');
  });

  it('shows EyeOff icon when showInternal is false', () => {
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={false}
        onToggleInternal={vi.fn()}
      />
    );
    expect(screen.getByText('EyeOff')).toBeInTheDocument();
  });

  it('shows Eye icon when showInternal is true', () => {
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={true}
        onToggleInternal={vi.fn()}
      />
    );
    expect(screen.getByText('Eye')).toBeInTheDocument();
  });

  it('clicking the internal toggle calls onToggleInternal', () => {
    const onToggleInternal = vi.fn();
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={false}
        onToggleInternal={onToggleInternal}
      />
    );
    // Button accessible name comes from text content (EyeOff + "Internal"), not title;
    // use getByTitle which queries the title attribute directly.
    const toggleBtn = screen.getByTitle('Show internal messages');
    fireEvent.click(toggleBtn);
    expect(onToggleInternal).toHaveBeenCalled();
  });

  it('toggle button has aria-pressed="true" when showInternal is true', () => {
    render(
      <ParticipantFilter
        participants={participants}
        activeFilter="all"
        onFilterChange={vi.fn()}
        showInternal={true}
        onToggleInternal={vi.fn()}
      />
    );
    const toggleBtn = screen.getByTitle('Hide internal messages');
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
