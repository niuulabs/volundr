import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeshSidebar } from './MeshSidebar';
import type { RoomParticipant } from '../types';

vi.mock('./MeshSidebar.module.css', () => ({ default: {} }));

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: '',
    color: 'p1',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

describe('MeshSidebar', () => {
  it('renders null when no ravn participants', () => {
    const humanOnly = new Map([
      ['peer-1', makeParticipant({ participantType: 'human' })],
    ]);
    const { container } = render(
      <MeshSidebar participants={humanOnly} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders null when participants map is empty', () => {
    const { container } = render(
      <MeshSidebar participants={new Map()} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows participant list with ravn agents', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', persona: 'Alpha' })],
      ['peer-2', makeParticipant({ peerId: 'peer-2', persona: 'Beta' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows status dot for each participant', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', status: 'busy' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    const statusDot = document.querySelector('[data-status="busy"]');
    expect(statusDot).toBeInTheDocument();
  });

  it('shows peer count in header', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1' })],
      ['peer-2', makeParticipant({ peerId: 'peer-2' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('clicking a participant calls onSelectPeer with the peerId', () => {
    const onSelectPeer = vi.fn();
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', persona: 'Alpha' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={onSelectPeer} />
    );
    const card = screen.getByText('Alpha').closest('[class]') ?? screen.getByText('Alpha');
    fireEvent.click(card);
    expect(onSelectPeer).toHaveBeenCalledWith('peer-1');
  });

  it('marks selected participant with data-selected="true"', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', persona: 'Alpha' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId="peer-1" onSelectPeer={vi.fn()} />
    );
    const card = document.querySelector('[data-selected="true"]');
    expect(card).toBeInTheDocument();
  });

  it('marks non-selected participants with data-selected="false"', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', persona: 'Alpha' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    const card = document.querySelector('[data-selected="false"]');
    expect(card).toBeInTheDocument();
  });

  it('shows status text for participant', () => {
    const participants = new Map([
      ['peer-1', makeParticipant({ peerId: 'peer-1', status: 'thinking' })],
    ]);
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />
    );
    expect(screen.getByText('thinking')).toBeInTheDocument();
  });
});
