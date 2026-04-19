import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeshSidebar } from './MeshSidebar';
import type { RoomParticipant } from '../../types';

const participants: ReadonlyMap<string, RoomParticipant> = new Map([
  [
    'peer-1',
    { peerId: 'peer-1', persona: 'Ada', participantType: 'ravn', status: 'idle', color: '#38bdf8' },
  ],
  [
    'peer-2',
    {
      peerId: 'peer-2',
      persona: 'Björk',
      participantType: 'ravn',
      status: 'thinking',
      color: '#a78bfa',
    },
  ],
  ['peer-3', { peerId: 'peer-3', persona: 'Skuld', participantType: 'skuld', status: 'idle' }],
]);

describe('MeshSidebar', () => {
  it('renders null when no ravn participants', () => {
    const noRavn: ReadonlyMap<string, RoomParticipant> = new Map([
      ['peer-3', { peerId: 'peer-3', persona: 'Skuld', participantType: 'skuld' }],
    ]);
    const { container } = render(
      <MeshSidebar participants={noRavn} selectedPeerId={null} onSelectPeer={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders only ravn participants', () => {
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />,
    );
    expect(screen.getByTestId('peer-card-peer-1')).toBeInTheDocument();
    expect(screen.getByTestId('peer-card-peer-2')).toBeInTheDocument();
    expect(screen.queryByTestId('peer-card-peer-3')).not.toBeInTheDocument();
  });

  it('shows peer count', () => {
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={vi.fn()} />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onSelectPeer when peer clicked', () => {
    const onSelectPeer = vi.fn();
    render(
      <MeshSidebar participants={participants} selectedPeerId={null} onSelectPeer={onSelectPeer} />,
    );
    fireEvent.click(screen.getByTestId('peer-card-peer-1'));
    expect(onSelectPeer).toHaveBeenCalledWith('peer-1');
  });

  it('marks selected peer', () => {
    render(
      <MeshSidebar participants={participants} selectedPeerId="peer-1" onSelectPeer={vi.fn()} />,
    );
    expect(screen.getByTestId('peer-card-peer-1').className).toContain('selected');
  });

  it('shows expand toggle when participant has metadata', () => {
    const withMeta: ReadonlyMap<string, RoomParticipant> = new Map([
      [
        'peer-1',
        {
          peerId: 'peer-1',
          persona: 'Ada',
          participantType: 'ravn',
          tools: ['bash', 'read_file'],
          subscribesTo: ['task_done'],
        },
      ],
    ]);
    render(<MeshSidebar participants={withMeta} selectedPeerId={null} onSelectPeer={vi.fn()} />);
    expect(screen.getByText('show details')).toBeInTheDocument();
  });

  it('expands metadata when toggle clicked', () => {
    const withMeta: ReadonlyMap<string, RoomParticipant> = new Map([
      [
        'peer-1',
        {
          peerId: 'peer-1',
          persona: 'Ada',
          participantType: 'ravn',
          tools: ['bash'],
        },
      ],
    ]);
    render(<MeshSidebar participants={withMeta} selectedPeerId={null} onSelectPeer={vi.fn()} />);
    fireEvent.click(screen.getByText('show details'));
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('hide details')).toBeInTheDocument();
  });
});
