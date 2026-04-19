import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThreadGroup } from './ThreadGroup';
import type { SkuldChatMessage, ParticipantMeta } from '../types';

vi.mock('./ThreadGroup.module.css', () => ({ default: {} }));
vi.mock('../RoomMessage/RoomMessage.module.css', () => ({ default: {} }));
vi.mock('../ChatMessages/ChatMessages.module.css', () => ({ default: {} }));
vi.mock('../MarkdownContent/MarkdownContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));

vi.mock('../RoomMessage/RoomMessage', () => ({
  RoomMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="room-message">{message.content}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  ChevronRight: () => <span>›</span>,
  ChevronDown: () => <span>⌄</span>,
}));

function makeParticipant(overrides: Partial<ParticipantMeta> = {}): ParticipantMeta {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: '',
    color: 'p1',
    participantType: 'ravn',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role: 'assistant',
    content: 'Message content',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

describe('ThreadGroup', () => {
  const messages = [
    makeMessage({
      content: 'First message',
      participant: makeParticipant({ persona: 'Alpha' }),
    }),
    makeMessage({
      content: 'Second message',
      participant: makeParticipant({ persona: 'Beta', peerId: 'peer-2' }),
    }),
  ];

  it('shows message count in header', () => {
    render(<ThreadGroup messages={messages} isCollapsed={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/2 messages/)).toBeInTheDocument();
  });

  it('shows participant personas in the header label', () => {
    render(<ThreadGroup messages={messages} isCollapsed={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Beta/)).toBeInTheDocument();
  });

  it('when collapsed (isCollapsed=true), body has data-expanded="false"', () => {
    render(<ThreadGroup messages={messages} isCollapsed={true} onToggle={vi.fn()} />);
    const body = document.querySelector('[data-expanded]');
    expect(body).toHaveAttribute('data-expanded', 'false');
  });

  it('when not collapsed (isCollapsed=false), body has data-expanded="true"', () => {
    render(<ThreadGroup messages={messages} isCollapsed={false} onToggle={vi.fn()} />);
    const body = document.querySelector('[data-expanded]');
    expect(body).toHaveAttribute('data-expanded', 'true');
  });

  it('clicking the header calls onToggle', () => {
    const onToggle = vi.fn();
    render(<ThreadGroup messages={messages} isCollapsed={true} onToggle={onToggle} />);
    const headerBtn = screen.getByRole('button');
    fireEvent.click(headerBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it('renders RoomMessage for each message', () => {
    render(<ThreadGroup messages={messages} isCollapsed={false} onToggle={vi.fn()} />);
    const roomMessages = screen.getAllByTestId('room-message');
    expect(roomMessages).toHaveLength(2);
  });

  it('shows messages content when expanded', () => {
    render(<ThreadGroup messages={messages} isCollapsed={false} onToggle={vi.fn()} />);
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  it('header aria-expanded is false when collapsed', () => {
    render(<ThreadGroup messages={messages} isCollapsed={true} onToggle={vi.fn()} />);
    const headerBtn = screen.getByRole('button');
    expect(headerBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('header aria-expanded is true when not collapsed', () => {
    render(<ThreadGroup messages={messages} isCollapsed={false} onToggle={vi.fn()} />);
    const headerBtn = screen.getByRole('button');
    expect(headerBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows "1 message" singular for single message', () => {
    const singleMessage = [makeMessage({ content: 'only one' })];
    render(<ThreadGroup messages={singleMessage} isCollapsed={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/1 message/)).toBeInTheDocument();
  });
});
