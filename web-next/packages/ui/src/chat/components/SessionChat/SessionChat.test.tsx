import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionChat } from './SessionChat';
import type { ChatMessage } from '../../types';

const messages: ChatMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Hello, help me',
    createdAt: new Date('2024-01-01T12:00:00'),
    status: 'done',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'Sure, I can help you.',
    createdAt: new Date('2024-01-01T12:00:05'),
    status: 'done',
  },
];

const defaultProps = {
  messages,
  onSend: vi.fn(),
  connected: true,
};

describe('SessionChat', () => {
  it('renders session chat container', () => {
    render(<SessionChat {...defaultProps} />);
    expect(screen.getByTestId('session-chat')).toBeInTheDocument();
  });

  it('shows connected status', () => {
    render(<SessionChat {...defaultProps} connected={true} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<SessionChat {...defaultProps} connected={false} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows message count', () => {
    render(<SessionChat {...defaultProps} />);
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('renders user messages', () => {
    render(<SessionChat {...defaultProps} />);
    expect(screen.getByText('Hello, help me')).toBeInTheDocument();
  });

  it('renders assistant messages', () => {
    render(<SessionChat {...defaultProps} />);
    expect(screen.getByText('Sure, I can help you.')).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(<SessionChat {...defaultProps} messages={[]} sessionName="Test Session" />);
    expect(screen.getByTestId('session-empty-chat')).toBeInTheDocument();
  });

  it('shows history loading indicator', () => {
    render(<SessionChat {...defaultProps} historyLoaded={false} />);
    expect(screen.getByTestId('history-loading')).toBeInTheDocument();
  });

  it('shows model switch button when capability enabled', () => {
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={vi.fn()}
      />
    );
    expect(screen.getByTestId('model-switch-toggle')).toBeInTheDocument();
  });

  it('does not show model switch button when capability disabled', () => {
    render(<SessionChat {...defaultProps} capabilities={{}} />);
    expect(screen.queryByTestId('model-switch-toggle')).not.toBeInTheDocument();
  });

  it('shows model input bar when toggle clicked', () => {
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.getByTestId('model-input-bar')).toBeInTheDocument();
  });

  it('shows thinking menu when toggle clicked', () => {
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_thinking_tokens: true }}
        onSetThinkingTokens={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    expect(screen.getByTestId('thinking-menu')).toBeInTheDocument();
  });

  it('calls onSetThinkingTokens when preset selected', () => {
    const onSetThinkingTokens = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_thinking_tokens: true }}
        onSetThinkingTokens={onSetThinkingTokens}
      />
    );
    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    fireEvent.click(screen.getByTestId('thinking-4K'));
    expect(onSetThinkingTokens).toHaveBeenCalledWith(4096);
  });

  it('shows clear button when messages exist and onClear provided', () => {
    render(<SessionChat {...defaultProps} onClear={vi.fn()} />);
    expect(screen.getByTestId('clear-chat')).toBeInTheDocument();
  });

  it('calls onClear when clear button clicked', () => {
    const onClear = vi.fn();
    render(<SessionChat {...defaultProps} onClear={onClear} />);
    fireEvent.click(screen.getByTestId('clear-chat'));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows rewind files button when capability enabled', () => {
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ rewind_files: true }}
        onRewindFiles={vi.fn()}
      />
    );
    expect(screen.getByTestId('rewind-files')).toBeInTheDocument();
  });

  it('calls onRewindFiles when rewind button clicked', () => {
    const onRewindFiles = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ rewind_files: true }}
        onRewindFiles={onRewindFiles}
      />
    );
    fireEvent.click(screen.getByTestId('rewind-files'));
    expect(onRewindFiles).toHaveBeenCalled();
  });

  it('submits model input on Enter key', () => {
    const onSetModel = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={onSetModel}
      />
    );
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    const modelInput = screen.getByLabelText('Model ID input');
    fireEvent.change(modelInput, { target: { value: 'claude-opus-4-6' } });
    fireEvent.keyDown(modelInput, { key: 'Enter' });
    expect(onSetModel).toHaveBeenCalledWith('claude-opus-4-6');
  });

  it('closes model input on Escape key', () => {
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.getByTestId('model-input-bar')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Model ID input'), { key: 'Escape' });
    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();
  });

  it('submits model input on submit button click', () => {
    const onSetModel = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={onSetModel}
      />
    );
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    fireEvent.change(screen.getByLabelText('Model ID input'), { target: { value: 'claude-haiku' } });
    fireEvent.click(screen.getByTestId('model-submit'));
    expect(onSetModel).toHaveBeenCalledWith('claude-haiku');
  });

  it('does not submit empty model input', () => {
    const onSetModel = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        capabilities={{ set_model: true }}
        onSetModel={onSetModel}
      />
    );
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    fireEvent.click(screen.getByTestId('model-submit'));
    expect(onSetModel).not.toHaveBeenCalled();
  });

  it('shows streaming message when streamingContent provided', () => {
    render(<SessionChat {...defaultProps} streamingContent="Thinking..." />);
    expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
  });

  it('renders single message in count', () => {
    const singleMsg = [messages[0]];
    render(<SessionChat {...defaultProps} messages={singleMsg} />);
    expect(screen.getByText('1 message')).toBeInTheDocument();
  });

  it('renders permissions slot when provided', () => {
    const renderPermissions = vi.fn().mockReturnValue(<div data-testid="perm-slot">Permissions</div>);
    render(
      <SessionChat
        {...defaultProps}
        pendingPermissions={[{ requestId: 'req-1', toolName: 'Bash', description: 'Run bash?' }]}
        renderPermissions={renderPermissions}
      />
    );
    expect(screen.getByTestId('perm-slot')).toBeInTheDocument();
    expect(renderPermissions).toHaveBeenCalled();
  });

  it('shows mesh cascade panel when meshEvents provided', () => {
    const meshEvents = [
      {
        id: 'ev1',
        type: 'outcome' as const,
        participantId: 'p1',
        participant: { color: '#38bdf8' },
        timestamp: new Date(),
        persona: 'Ada',
        eventType: 'review',
        verdict: 'pass' as const,
        summary: 'Test passed',
      },
    ];
    render(<SessionChat {...defaultProps} meshEvents={meshEvents} />);
    expect(screen.getByTestId('mesh-cascade-panel')).toBeInTheDocument();
  });

  it('renders room messages when participants provided', () => {
    const participants = new Map([
      ['p1', { peerId: 'p1', persona: 'Ada' }],
    ]);
    const roomMessages = [
      {
        id: 'm1',
        role: 'assistant' as const,
        content: 'Room response',
        createdAt: new Date(),
        participant: { peerId: 'p1', persona: 'Ada' },
      },
    ];
    render(
      <SessionChat
        {...defaultProps}
        messages={roomMessages}
        participants={participants}
      />
    );
    expect(screen.getByTestId('room-message')).toBeInTheDocument();
  });

  it('shows internal toggle in room mode when connected (2+ participants)', () => {
    const participants = new Map([
      ['p1', { peerId: 'p1', persona: 'Ada' }],
      ['p2', { peerId: 'p2', persona: 'Björk' }],
    ]);
    render(
      <SessionChat
        {...defaultProps}
        participants={participants}
        connected={true}
      />
    );
    expect(screen.getByTestId('internal-toggle')).toBeInTheDocument();
  });

  it('calls onMessageCountChange when messages change', () => {
    const onMessageCountChange = vi.fn();
    render(
      <SessionChat
        {...defaultProps}
        onMessageCountChange={onMessageCountChange}
      />
    );
    expect(onMessageCountChange).toHaveBeenCalledWith(2);
  });
});
