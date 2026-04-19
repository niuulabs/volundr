import React from 'react';
import { render, screen } from '@testing-library/react';
import { RoomMessage } from './RoomMessage';
import type { SkuldChatMessage, ParticipantMeta } from '../types';

vi.mock('./RoomMessage.module.css', () => ({ default: {} }));
vi.mock('../ChatMessages/ChatMessages.module.css', () => ({ default: {} }));
vi.mock('../MarkdownContent/MarkdownContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));

// Mock ChatMessages sub-components to avoid deep rendering
vi.mock('../ChatMessages/ChatMessages', () => ({
  UserMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="user-message">{message.content}</div>
  ),
  AssistantMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="assistant-message">{message.content}</div>
  ),
  StreamingMessage: ({ content }: { content: string }) => (
    <div data-testid="streaming-message">{content}</div>
  ),
  SystemMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="system-message">{message.content}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  Eye: () => <span>Eye</span>,
}));

function makeParticipant(overrides: Partial<ParticipantMeta> = {}): ParticipantMeta {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: 'Alpha',
    color: 'p1',
    participantType: 'ravn',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello from agent',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

describe('RoomMessage', () => {
  it('shows participant persona label when participant is a ravn agent', () => {
    const message = makeMessage({
      participant: makeParticipant({ persona: 'Agent Alpha' }),
    });
    render(<RoomMessage message={message} />);
    expect(screen.getByText('Alpha (Agent Alpha)')).toBeInTheDocument();
  });

  it('renders assistant message content', () => {
    const message = makeMessage({ content: 'This is the response' });
    render(<RoomMessage message={message} />);
    expect(screen.getByTestId('assistant-message')).toBeInTheDocument();
    expect(screen.getByText('This is the response')).toBeInTheDocument();
  });

  it('renders user message when role is user', () => {
    const message = makeMessage({ role: 'user', content: 'User input' });
    render(<RoomMessage message={message} />);
    expect(screen.getByTestId('user-message')).toBeInTheDocument();
  });

  it('renders streaming message when status is running', () => {
    const message = makeMessage({ status: 'running', content: 'streaming...' });
    render(<RoomMessage message={message} />);
    expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
  });

  it('renders system message directly for system messageType', () => {
    const message = makeMessage({
      content: 'System notification',
      metadata: { messageType: 'system' },
    });
    render(<RoomMessage message={message} />);
    expect(screen.getByTestId('system-message')).toBeInTheDocument();
  });

  it('renders content without participant label when no participant', () => {
    const message = makeMessage({ content: 'Plain message' });
    render(<RoomMessage message={message} />);
    expect(screen.getByTestId('assistant-message')).toBeInTheDocument();
    expect(screen.queryByTestId('participant-label')).toBeNull();
  });

  it('does not render participant label for human participants', () => {
    const message = makeMessage({
      participant: makeParticipant({ participantType: 'human', persona: 'User' }),
    });
    render(<RoomMessage message={message} />);
    expect(screen.queryByTestId('participant-label')).toBeNull();
  });
});
