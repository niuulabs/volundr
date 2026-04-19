import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionChat } from './SessionChat';
import type { SessionChatSession } from '../types';
import { DEFAULT_CAPABILITIES } from '../types';

vi.mock('./SessionChat.module.css', () => ({ default: {} }));
vi.mock('../RoomMessage/RoomMessage.module.css', () => ({ default: {} }));
vi.mock('../ChatMessages/ChatMessages.module.css', () => ({ default: {} }));
vi.mock('../MarkdownContent/MarkdownContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));
vi.mock('../ThreadGroup/ThreadGroup.module.css', () => ({ default: {} }));
vi.mock('../MeshSidebar/MeshSidebar.module.css', () => ({ default: {} }));
vi.mock('../MeshCascadePanel/MeshCascadePanel.module.css', () => ({ default: {} }));
vi.mock('../ChatInput/ChatInput.module.css', () => ({ default: {} }));
vi.mock('../ChatEmptyStates/ChatEmptyStates.module.css', () => ({ default: {} }));
vi.mock('../FilterTabs/FilterTabs.module.css', () => ({ default: {} }));

vi.mock('../ChatMessages/ChatMessages', () => ({
  UserMessage: () => null,
  AssistantMessage: () => null,
  StreamingMessage: () => null,
  SystemMessage: () => null,
}));

vi.mock('../ChatInput/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('../ChatEmptyStates/ChatEmptyStates', () => ({
  SessionEmptyChat: () => <div data-testid="empty-chat" />,
}));

vi.mock('../MeshSidebar/MeshSidebar', () => ({
  MeshSidebar: () => null,
}));

vi.mock('../MeshCascadePanel/MeshCascadePanel', () => ({
  MeshCascadePanel: () => null,
}));

vi.mock('../RoomMessage/RoomMessage', () => ({
  RoomMessage: () => null,
}));

vi.mock('../ThreadGroup/ThreadGroup', () => ({
  ThreadGroup: () => null,
}));

vi.mock('lucide-react', () => ({
  Wifi: () => <span>Wifi</span>,
  WifiOff: () => <span>WifiOff</span>,
  BrainCircuitIcon: () => null,
  RotateCcwIcon: () => null,
  ArrowDownIcon: () => null,
  Eye: () => null,
  EyeOff: () => null,
  Trash2Icon: () => null,
}));

function makeSession(overrides: Partial<SessionChatSession> = {}): SessionChatSession {
  return {
    messages: [],
    participants: new Map(),
    meshEvents: [],
    agentEvents: new Map(),
    connected: true,
    isRunning: false,
    historyLoaded: true,
    pendingPermissions: [],
    availableCommands: [],
    capabilities: { ...DEFAULT_CAPABILITIES },
    sendMessage: vi.fn(),
    interrupt: vi.fn(),
    respondToPermission: vi.fn(),
    clearMessages: vi.fn(),
    ...overrides,
  };
}

describe('SessionChat', () => {
  it('shows "Disconnected" when connected=false', () => {
    const session = makeSession({ connected: false });
    render(<SessionChat session={session} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows "Connected" when connected=true', () => {
    const session = makeSession({ connected: true });
    render(<SessionChat session={session} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows WifiOff icon when disconnected', () => {
    const session = makeSession({ connected: false });
    render(<SessionChat session={session} />);
    expect(screen.getByText('WifiOff')).toBeInTheDocument();
  });

  it('shows Wifi icon when connected', () => {
    const session = makeSession({ connected: true });
    render(<SessionChat session={session} />);
    expect(screen.getByText('Wifi')).toBeInTheDocument();
  });

  it('shows empty chat when no messages', () => {
    const session = makeSession({ messages: [] });
    render(<SessionChat session={session} />);
    expect(screen.getByTestId('empty-chat')).toBeInTheDocument();
  });

  it('renders ChatInput', () => {
    const session = makeSession();
    render(<SessionChat session={session} />);
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('shows message count', () => {
    const session = makeSession({
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
          status: 'complete',
        },
      ],
    });
    render(<SessionChat session={session} />);
    expect(screen.getByText('1 message')).toBeInTheDocument();
  });

  it('shows "0 messages" when no visible messages', () => {
    const session = makeSession({ messages: [] });
    render(<SessionChat session={session} />);
    expect(screen.getByText('0 messages')).toBeInTheDocument();
  });

  it('clear chat button calls session.clearMessages when clicked', () => {
    const clearMessages = vi.fn();
    const session = makeSession({
      clearMessages,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
          status: 'complete',
        },
      ],
    });
    render(<SessionChat session={session} />);
    const clearBtn = screen.getByTestId('clear-chat');
    fireEvent.click(clearBtn);
    expect(clearMessages).toHaveBeenCalled();
  });

  it('does not render clear button when no messages', () => {
    const session = makeSession({ messages: [] });
    render(<SessionChat session={session} />);
    expect(screen.queryByTestId('clear-chat')).toBeNull();
  });

  it('shows "Loading conversation..." when historyLoaded=false and connected=true', () => {
    const session = makeSession({ historyLoaded: false, connected: true });
    render(<SessionChat session={session} />);
    expect(screen.getByTestId('history-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
  });

  it('shows model switch button when capabilities.set_model=true', () => {
    const session = makeSession({
      capabilities: { ...DEFAULT_CAPABILITIES, set_model: true },
    });
    render(<SessionChat session={session} />);
    expect(screen.getByTestId('model-switch-toggle')).toBeInTheDocument();
  });

  it('does not show model switch button when capabilities.set_model=false', () => {
    const session = makeSession({
      capabilities: { ...DEFAULT_CAPABILITIES, set_model: false },
    });
    render(<SessionChat session={session} />);
    expect(screen.queryByTestId('model-switch-toggle')).toBeNull();
  });
});
