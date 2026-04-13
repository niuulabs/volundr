import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThreadGroup } from './ThreadGroup';
import type { SkuldChatMessage, RoomParticipant } from '@/modules/shared/hooks/useSkuldChat';

// Mock RoomMessage so we focus on ThreadGroup behavior
vi.mock('../RoomMessage', () => ({
  RoomMessage: ({ message }: { message: SkuldChatMessage }) => (
    <div data-testid={`room-message-${message.id}`}>{message.content}</div>
  ),
}));

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'internal message',
    createdAt: new Date(),
    status: 'complete',
    visibility: 'internal',
    threadId: 'thread-abc',
    participant: {
      peerId: 'peer-1',
      persona: 'Ravn-A',
      color: 'amber',
      participantType: 'ravn',
    },
    participantId: 'peer-1',
    ...overrides,
  };
}

function makeParticipantsMap(
  participants: RoomParticipant[]
): ReadonlyMap<string, RoomParticipant> {
  return new Map(participants.map(p => [p.peerId, p]));
}

describe('ThreadGroup', () => {
  const participants = makeParticipantsMap([
    {
      peerId: 'peer-1',
      persona: 'Ravn-A',
      color: 'amber',
      participantType: 'ravn',
      status: 'idle',
      joinedAt: new Date(),
    },
    {
      peerId: 'peer-2',
      persona: 'Ravn-B',
      color: 'cyan',
      participantType: 'ravn',
      status: 'idle',
      joinedAt: new Date(),
    },
  ]);

  const twoMessages = [
    makeMessage({
      id: 'msg-1',
      content: 'message one',
      participant: { peerId: 'peer-1', persona: 'Ravn-A', color: 'amber', participantType: 'ravn' },
    }),
    makeMessage({
      id: 'msg-2',
      content: 'message two',
      participantId: 'peer-2',
      participant: { peerId: 'peer-2', persona: 'Ravn-B', color: 'cyan', participantType: 'ravn' },
    }),
  ];

  it('renders collapsed by default', () => {
    const { container } = render(
      <ThreadGroup messages={twoMessages} participants={participants} />
    );
    const body = container.querySelector('[data-expanded]');
    expect(body).toHaveAttribute('data-expanded', 'false');
  });

  it('shows message count in label', () => {
    render(<ThreadGroup messages={twoMessages} participants={participants} />);
    expect(screen.getByText(/2 messages/)).toBeInTheDocument();
  });

  it('shows participant personas in label', () => {
    render(<ThreadGroup messages={twoMessages} participants={participants} />);
    expect(screen.getByText(/Ravn-A/)).toBeInTheDocument();
    expect(screen.getByText(/Ravn-B/)).toBeInTheDocument();
  });

  it('expands when header is clicked', () => {
    render(<ThreadGroup messages={twoMessages} participants={participants} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('room-message-msg-1')).toBeInTheDocument();
    expect(screen.getByTestId('room-message-msg-2')).toBeInTheDocument();
  });

  it('collapses when header is clicked again', () => {
    const { container } = render(
      <ThreadGroup messages={twoMessages} participants={participants} />
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    const body = container.querySelector('[data-expanded]');
    expect(body).toHaveAttribute('data-expanded', 'false');
  });

  it('sets aria-expanded=false when collapsed', () => {
    render(<ThreadGroup messages={twoMessages} participants={participants} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('sets aria-expanded=true when expanded', () => {
    render(<ThreadGroup messages={twoMessages} participants={participants} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows singular "message" for single message', () => {
    const one = [makeMessage({ id: 'msg-1' })];
    render(<ThreadGroup messages={one} participants={participants} />);
    expect(screen.getByText(/1 message/)).toBeInTheDocument();
    expect(screen.queryByText(/1 messages/)).not.toBeInTheDocument();
  });
});
