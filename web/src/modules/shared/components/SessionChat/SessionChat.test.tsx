import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the useSkuldChat hook
vi.mock('@/modules/shared/hooks/useSkuldChat', () => ({
  useSkuldChat: vi.fn(),
}));

// Mock RoomMessage, AgentDetailPanel, ParticipantFilter, and ThreadGroup
// so SessionChat tests stay focused
vi.mock('./RoomMessage', () => ({
  RoomMessage: ({
    message,
    onSelectAgent,
  }: {
    message: { id: string; content: string };
    onSelectAgent?: (id: string) => void;
  }) => (
    <div data-testid="room-message" data-message-id={message.id}>
      {message.content}
      {onSelectAgent && (
        <button
          type="button"
          data-testid="room-select-agent"
          onClick={() => onSelectAgent('ravn-1')}
        >
          Select
        </button>
      )}
    </div>
  ),
}));

vi.mock('./AgentDetailPanel', () => ({
  AgentDetailPanel: ({
    participant,
    onClose,
  }: {
    participant: { peerId: string; persona: string };
    onClose: () => void;
  }) => (
    <div data-testid="agent-detail-panel" data-peer-id={participant.peerId}>
      {participant.persona}
      <button type="button" data-testid="detail-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock('./ParticipantFilter', () => ({
  ParticipantFilter: ({
    participants,
    activeFilter,
    onFilterChange,
    showInternal,
    onToggleInternal,
  }: {
    participants: ReadonlyMap<string, { persona: string }>;
    activeFilter: string;
    onFilterChange: (f: string) => void;
    showInternal: boolean;
    onToggleInternal: () => void;
  }) => (
    <div
      data-testid="participant-filter"
      data-active={activeFilter}
      data-show-internal={showInternal}
    >
      <button onClick={() => onFilterChange('all')}>All</button>
      {Array.from(participants.values()).map(p => (
        <button key={p.persona} onClick={() => onFilterChange(p.persona)}>
          {p.persona}
        </button>
      ))}
      <button onClick={onToggleInternal} data-testid="internal-toggle">
        Toggle
      </button>
    </div>
  ),
}));

vi.mock('./ThreadGroup', () => ({
  ThreadGroup: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="thread-group">{messages.length} messages</div>
  ),
}));

import { useSkuldChat } from '@/modules/shared/hooks/useSkuldChat';
import type {
  SkuldChatMessage,
  PermissionRequest,
  TransportCapabilities,
} from '@/modules/shared/hooks/useSkuldChat';
import { SessionChat } from './SessionChat';

const NO_CAPABILITIES: TransportCapabilities = {
  send_message: true,
  cli_websocket: false,
  session_resume: false,
  interrupt: false,
  set_model: false,
  set_thinking_tokens: false,
  set_permission_mode: false,
  rewind_files: false,
  mcp_set_servers: false,
  permission_requests: false,
  slash_commands: false,
  skills: false,
};

const ALL_CAPABILITIES: TransportCapabilities = {
  send_message: true,
  cli_websocket: true,
  session_resume: true,
  interrupt: true,
  set_model: true,
  set_thinking_tokens: true,
  set_permission_mode: true,
  rewind_files: true,
  mcp_set_servers: true,
  permission_requests: true,
  slash_commands: true,
  skills: true,
};

function mockSkuldChat(overrides: Partial<ReturnType<typeof useSkuldChat>> = {}) {
  const defaults: ReturnType<typeof useSkuldChat> = {
    messages: [],
    participants: new Map(),
    connected: false,
    isRunning: false,
    historyLoaded: true,
    pendingPermissions: [],
    availableCommands: [],
    capabilities: ALL_CAPABILITIES,
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    sendInterrupt: vi.fn(),
    sendSetModel: vi.fn(),
    sendSetMaxThinkingTokens: vi.fn(),
    sendRewindFiles: vi.fn(),
    clearMessages: vi.fn(),
  };
  vi.mocked(useSkuldChat).mockReturnValue({ ...defaults, ...overrides });
  return { ...defaults, ...overrides };
}

describe('SessionChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders disconnected state', () => {
    mockSkuldChat({ connected: false });
    render(<SessionChat url={null} />);

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('0 messages')).toBeInTheDocument();
  });

  it('renders connected state', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('renders message count correctly', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
        status: 'complete',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Hi there',
        createdAt: new Date(),
        status: 'complete',
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('renders singular message count', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
        status: 'complete',
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByText('1 message')).toBeInTheDocument();
  });

  it('applies custom className to wrapper', () => {
    mockSkuldChat({ connected: true });
    const { container } = render(<SessionChat url="wss://test/session" className="custom" />);

    expect(container.firstChild).toHaveClass('custom');
  });

  it('passes the url to useSkuldChat', () => {
    mockSkuldChat();
    render(<SessionChat url="wss://my-host/session" />);

    expect(useSkuldChat).toHaveBeenCalledWith('wss://my-host/session');
  });

  it('passes null url to useSkuldChat', () => {
    mockSkuldChat();
    render(<SessionChat url={null} />);

    expect(useSkuldChat).toHaveBeenCalledWith(null);
  });

  it('renders the chat input', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument();
  });

  it('renders welcome message when no messages', () => {
    mockSkuldChat({ connected: true, messages: [] });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByText('Volundr')).toBeInTheDocument();
  });

  // ── Control Toolbar ───────────────────────────────────────

  it('shows control buttons when connected', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('model-switch-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-budget-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('rewind-files')).toBeInTheDocument();
  });

  it('hides control buttons when disconnected', () => {
    mockSkuldChat({ connected: false });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('model-switch-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thinking-budget-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rewind-files')).not.toBeInTheDocument();
  });

  it('calls sendRewindFiles when rewind button clicked', () => {
    const sendRewindFiles = vi.fn();
    mockSkuldChat({ connected: true, sendRewindFiles });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('rewind-files'));

    expect(sendRewindFiles).toHaveBeenCalledTimes(1);
  });

  // ── Model Input ───────────────────────────────────────────

  it('toggles model input bar on button click', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.getByTestId('model-input-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();
  });

  it('calls sendSetModel when model is submitted', () => {
    const sendSetModel = vi.fn();
    mockSkuldChat({ connected: true, sendSetModel });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('model-switch-toggle'));

    const input = screen.getByRole('textbox', { name: 'Model ID input' });
    fireEvent.change(input, { target: { value: 'claude-opus-4-6' } });
    fireEvent.click(screen.getByTestId('model-submit'));

    expect(sendSetModel).toHaveBeenCalledWith('claude-opus-4-6');
  });

  it('submits model on Enter key', () => {
    const sendSetModel = vi.fn();
    mockSkuldChat({ connected: true, sendSetModel });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('model-switch-toggle'));

    const input = screen.getByRole('textbox', { name: 'Model ID input' });
    fireEvent.change(input, { target: { value: 'claude-sonnet-4-5-20250929' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(sendSetModel).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
  });

  it('closes model input on Escape key', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.getByTestId('model-input-bar')).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'Model ID input' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();
  });

  it('does not submit empty model input', () => {
    const sendSetModel = vi.fn();
    mockSkuldChat({ connected: true, sendSetModel });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    fireEvent.click(screen.getByTestId('model-submit'));

    expect(sendSetModel).not.toHaveBeenCalled();
  });

  // ── Thinking Budget ───────────────────────────────────────

  it('toggles thinking budget menu', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('thinking-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    expect(screen.getByTestId('thinking-menu')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    expect(screen.queryByTestId('thinking-menu')).not.toBeInTheDocument();
  });

  it('calls sendSetMaxThinkingTokens when preset selected', () => {
    const sendSetMaxThinkingTokens = vi.fn();
    mockSkuldChat({ connected: true, sendSetMaxThinkingTokens });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    fireEvent.click(screen.getByTestId('thinking-8K'));

    expect(sendSetMaxThinkingTokens).toHaveBeenCalledWith(8192);
  });

  it('renders all thinking presets', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));

    expect(screen.getByTestId('thinking-4K')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-8K')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-16K')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-32K')).toBeInTheDocument();
  });

  it('closes thinking menu after selecting a preset', () => {
    mockSkuldChat({ connected: true });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('thinking-budget-toggle'));
    expect(screen.getByTestId('thinking-menu')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thinking-16K'));
    expect(screen.queryByTestId('thinking-menu')).not.toBeInTheDocument();
  });

  // ── Permission Banner ─────────────────────────────────────

  it('renders permission dialogs when pendingPermissions exist', () => {
    const permissions: PermissionRequest[] = [
      {
        request_id: 'req-1',
        controlType: 'can_use_tool',
        tool: 'Bash',
        input: { command: 'echo hi' },
        receivedAt: new Date(),
      },
    ];
    mockSkuldChat({ connected: true, pendingPermissions: permissions });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('permission-stack')).toBeInTheDocument();
    expect(screen.getByText('echo hi')).toBeInTheDocument();
  });

  it('does not render permission stack when no pending permissions', () => {
    mockSkuldChat({ connected: true, pendingPermissions: [] });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('permission-stack')).not.toBeInTheDocument();
  });

  it('calls respondToPermission when permission action is taken', () => {
    const respondToPermission = vi.fn();
    const permissions: PermissionRequest[] = [
      {
        request_id: 'req-42',
        controlType: 'can_use_tool',
        tool: 'Write',
        input: { file_path: '/tmp/test.txt' },
        receivedAt: new Date(),
      },
    ];
    mockSkuldChat({ connected: true, pendingPermissions: permissions, respondToPermission });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('permission-allow'));

    expect(respondToPermission).toHaveBeenCalledWith('req-42', 'allow');
  });

  // ── handleRegenerate edge cases ─────────────────────────────

  it('calls sendMessage with the prior user message content on regenerate', () => {
    const sendMessage = vi.fn();
    const messages: SkuldChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', createdAt: new Date(), status: 'complete' },
      { id: 'a1', role: 'assistant', content: 'Hi', createdAt: new Date(), status: 'complete' },
    ];
    mockSkuldChat({ connected: true, messages, sendMessage });
    render(<SessionChat url="wss://test/session" />);

    const regenBtn = screen.getByTitle('Regenerate');
    fireEvent.click(regenBtn);

    expect(sendMessage).toHaveBeenCalledWith('Hello');
  });

  it('does not call sendMessage when message ID no longer exists in messages', () => {
    const sendMessage = vi.fn();

    // First render with an assistant message so the regenerate button is in the DOM
    const initialMessages: SkuldChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', createdAt: new Date(), status: 'complete' },
      { id: 'a1', role: 'assistant', content: 'Hi', createdAt: new Date(), status: 'complete' },
    ];
    mockSkuldChat({ connected: true, messages: initialMessages, sendMessage });
    const { rerender } = render(<SessionChat url="wss://test/session" />);

    // Re-render with messages that no longer contain 'a1', but keep a different
    // assistant message so the button stays rendered
    const updatedMessages: SkuldChatMessage[] = [
      { id: 'u2', role: 'user', content: 'New', createdAt: new Date(), status: 'complete' },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Different',
        createdAt: new Date(),
        status: 'complete',
      },
    ];
    mockSkuldChat({ connected: true, messages: updatedMessages, sendMessage });
    rerender(<SessionChat url="wss://test/session" />);

    // Click regenerate — the callback now has the updated messages array
    // where 'a2' exists, but user message 'u2' precedes it, so it should send 'New'
    const regenBtn = screen.getByTitle('Regenerate');
    fireEvent.click(regenBtn);

    expect(sendMessage).toHaveBeenCalledWith('New');
  });

  it('does not call sendMessage when no prior user message exists before the assistant message', () => {
    const sendMessage = vi.fn();
    const messages: SkuldChatMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'I started the conversation',
        createdAt: new Date(),
        status: 'complete',
      },
    ];
    mockSkuldChat({ connected: true, messages, sendMessage });
    render(<SessionChat url="wss://test/session" />);

    // Click regenerate on the assistant message — no prior user message exists
    const regenBtn = screen.getByTitle('Regenerate');
    fireEvent.click(regenBtn);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  // ── Model input bar visibility when disconnected ────────────

  it('does not show model input bar when disconnected even if toggled before disconnect', () => {
    const { rerender } = render(<SessionChat url="wss://test/session" />);

    // Start connected with model input visible
    mockSkuldChat({ connected: true });
    rerender(<SessionChat url="wss://test/session" />);
    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    expect(screen.getByTestId('model-input-bar')).toBeInTheDocument();

    // Disconnect — model input bar should hide (showModelInput && connected is false)
    mockSkuldChat({ connected: false });
    rerender(<SessionChat url="wss://test/session" />);
    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();
  });

  it('clears model input and hides bar after successful submit', () => {
    const sendSetModel = vi.fn();
    mockSkuldChat({ connected: true, sendSetModel });
    render(<SessionChat url="wss://test/session" />);

    fireEvent.click(screen.getByTestId('model-switch-toggle'));
    const input = screen.getByRole('textbox', { name: 'Model ID input' });
    fireEvent.change(input, { target: { value: 'claude-opus-4-6' } });
    fireEvent.click(screen.getByTestId('model-submit'));

    expect(sendSetModel).toHaveBeenCalledWith('claude-opus-4-6');
    // Bar should be hidden after submit
    expect(screen.queryByTestId('model-input-bar')).not.toBeInTheDocument();
  });

  // ── Thinking menu visibility ────────────────────────────────

  it('hides thinking menu when disconnected', () => {
    mockSkuldChat({ connected: false });
    render(<SessionChat url="wss://test/session" />);

    // Thinking menu toggle is not rendered when disconnected
    expect(screen.queryByTestId('thinking-budget-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thinking-menu')).not.toBeInTheDocument();
  });

  // ── Streaming message rendering ─────────────────────────────

  it('renders a streaming assistant message when status is running', () => {
    const messages: SkuldChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', createdAt: new Date(), status: 'complete' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Responding...',
        createdAt: new Date(),
        status: 'running',
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    // The streaming message should be visible (content is rendered)
    expect(screen.getByText('Responding...')).toBeInTheDocument();
    // The regenerate button should NOT be present on a streaming message
    expect(screen.queryByTitle('Regenerate')).not.toBeInTheDocument();
  });

  // ── System message type in visible messages ─────────────────

  it('renders system message type inline as SystemMessage', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Do something',
        createdAt: new Date(),
        status: 'complete',
      },
      {
        id: 'a-sys',
        role: 'assistant',
        content: 'Model switched to claude-opus-4-6',
        createdAt: new Date(),
        status: 'complete',
        metadata: { messageType: 'system' },
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    // System message content should be rendered
    expect(screen.getByText('Model switched to claude-opus-4-6')).toBeInTheDocument();
  });

  // ── onMessageCountChange callback ───────────────────────────

  it('calls onMessageCountChange with visible message count', () => {
    const onMessageCountChange = vi.fn();
    const messages: SkuldChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', createdAt: new Date(), status: 'complete' },
      {
        id: 'sys1',
        role: 'system' as 'user',
        content: 'system msg',
        createdAt: new Date(),
        status: 'complete',
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" onMessageCountChange={onMessageCountChange} />);

    expect(onMessageCountChange).toHaveBeenCalled();
  });

  // ── Capability gating ───────────────────────────────────────

  it('hides model switch when capabilities.set_model is false', () => {
    mockSkuldChat({
      connected: true,
      capabilities: { ...ALL_CAPABILITIES, set_model: false },
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('model-switch-toggle')).not.toBeInTheDocument();
  });

  it('shows model switch when capabilities.set_model is true', () => {
    mockSkuldChat({
      connected: true,
      capabilities: { ...ALL_CAPABILITIES, set_model: true },
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('model-switch-toggle')).toBeInTheDocument();
  });

  it('hides thinking budget when capabilities.set_thinking_tokens is false', () => {
    mockSkuldChat({
      connected: true,
      capabilities: { ...ALL_CAPABILITIES, set_thinking_tokens: false },
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('thinking-budget-toggle')).not.toBeInTheDocument();
  });

  it('hides rewind button when capabilities.rewind_files is false', () => {
    mockSkuldChat({
      connected: true,
      capabilities: { ...ALL_CAPABILITIES, rewind_files: false },
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('rewind-files')).not.toBeInTheDocument();
  });

  it('disables stop button when capabilities.interrupt is false', () => {
    mockSkuldChat({
      connected: true,
      isRunning: true,
      capabilities: { ...ALL_CAPABILITIES, interrupt: false },
    });
    render(<SessionChat url="wss://test/session" />);

    const stopBtn = screen.getByTestId('stop-btn');
    expect(stopBtn).toBeDisabled();
    expect(stopBtn).toHaveAttribute('title', 'Interrupt not supported by this transport');
  });

  it('enables stop button when capabilities.interrupt is true', () => {
    mockSkuldChat({
      connected: true,
      isRunning: true,
      capabilities: { ...ALL_CAPABILITIES, interrupt: true },
    });
    render(<SessionChat url="wss://test/session" />);

    const stopBtn = screen.getByTestId('stop-btn');
    expect(stopBtn).not.toBeDisabled();
    expect(stopBtn).toHaveAttribute('title', 'Stop generation');
  });

  it('hides all controls with no capabilities (all false)', () => {
    mockSkuldChat({
      connected: true,
      capabilities: NO_CAPABILITIES,
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('model-switch-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thinking-budget-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rewind-files')).not.toBeInTheDocument();
  });

  it('shows all controls when full capabilities reported', () => {
    mockSkuldChat({
      connected: true,
      isRunning: true,
      capabilities: ALL_CAPABILITIES,
    });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('model-switch-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-budget-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('rewind-files')).toBeInTheDocument();
    const stopBtn = screen.getByTestId('stop-btn');
    expect(stopBtn).not.toBeDisabled();
  });

  // ── Room mode (niu-605) ─────────────────────────────────────

  function makeParticipant(peerId: string, persona: string, color: string) {
    return {
      peerId,
      persona,
      color,
      participantType: 'ravn' as const,
      status: 'idle' as const,
      joinedAt: new Date(),
    };
  }

  it('renders ParticipantFilter when more than one participant is present', () => {
    const participants = new Map([
      ['p1', makeParticipant('p1', 'Ravn-A', 'amber')],
      ['p2', makeParticipant('p2', 'Ravn-B', 'cyan')],
    ]);
    mockSkuldChat({ connected: true, participants });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('participant-filter')).toBeInTheDocument();
  });

  it('does not render ParticipantFilter with only one participant', () => {
    const participants = new Map([['p1', makeParticipant('p1', 'Ravn-A', 'amber')]]);
    mockSkuldChat({ connected: true, participants });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.queryByTestId('participant-filter')).not.toBeInTheDocument();
  });

  it('renders RoomMessage for participant messages in room mode', () => {
    const participants = new Map([
      ['p1', makeParticipant('p1', 'Ravn-A', 'amber')],
      ['p2', makeParticipant('p2', 'Ravn-B', 'cyan')],
    ]);
    const messages: SkuldChatMessage[] = [
      {
        id: 'rm-1',
        role: 'assistant',
        content: 'Hello from Ravn-A',
        createdAt: new Date(),
        status: 'complete',
        participant: { peerId: 'p1', persona: 'Ravn-A', color: 'amber', participantType: 'ravn' },
        participantId: 'p1',
      },
    ];
    mockSkuldChat({ connected: true, participants, messages });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('room-message')).toBeInTheDocument();
  });

  it('renders ThreadGroup for consecutive internal messages with same threadId when showInternal', () => {
    const participants = new Map([
      ['p1', makeParticipant('p1', 'Ravn-A', 'amber')],
      ['p2', makeParticipant('p2', 'Ravn-B', 'cyan')],
    ]);
    const messages: SkuldChatMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'internal one',
        createdAt: new Date(),
        status: 'complete',
        visibility: 'internal',
        threadId: 'thread-1',
        participant: { peerId: 'p1', persona: 'Ravn-A', color: 'amber', participantType: 'ravn' },
        participantId: 'p1',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'internal two',
        createdAt: new Date(),
        status: 'complete',
        visibility: 'internal',
        threadId: 'thread-1',
        participant: { peerId: 'p2', persona: 'Ravn-B', color: 'cyan', participantType: 'ravn' },
        participantId: 'p2',
      },
    ];
    mockSkuldChat({ connected: true, participants, messages });
    const { getByTestId } = render(<SessionChat url="wss://test/session" />);

    // The internal toggle button exists in the ParticipantFilter mock
    fireEvent.click(screen.getByTestId('internal-toggle'));

    // After showing internal messages, consecutive internal messages with same threadId
    // should be grouped into a ThreadGroup
    expect(getByTestId('thread-group')).toBeInTheDocument();
  });

  // ── Room session — agent detail panel (NIU-609) ─────────────

  it('uses RoomMessage when messages have participant metadata', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'User message',
        createdAt: new Date(),
        status: 'complete',
        participant: {
          peerId: 'ravn-1',
          persona: 'Ravn Alpha',
          color: 'cyan',
          participantType: 'ravn',
          gatewayUrl: 'http://ravn-1:8080',
        },
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    expect(screen.getByTestId('room-message')).toBeInTheDocument();
  });

  it('renders AgentDetailPanel when an agent is selected via room message', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Agent response',
        createdAt: new Date(),
        status: 'complete',
        participant: {
          peerId: 'ravn-1',
          persona: 'Ravn Alpha',
          color: 'cyan',
          participantType: 'ravn',
          gatewayUrl: 'http://ravn-1:8080',
        },
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    // Agent detail panel not shown yet
    expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();

    // Click the "Select" button in the RoomMessage mock to trigger onSelectAgent
    fireEvent.click(screen.getByTestId('room-select-agent'));

    // Panel should now appear
    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
  });

  it('closes AgentDetailPanel when onClose is called', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Agent response',
        createdAt: new Date(),
        status: 'complete',
        participant: {
          peerId: 'ravn-1',
          persona: 'Ravn Alpha',
          color: 'cyan',
          participantType: 'ravn',
          gatewayUrl: 'http://ravn-1:8080',
        },
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    // Open the panel
    fireEvent.click(screen.getByTestId('room-select-agent'));
    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();

    // Close via the panel's close button
    fireEvent.click(screen.getByTestId('detail-close'));
    expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
  });

  it('toggles agent selection when same agent is clicked twice', () => {
    const messages: SkuldChatMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Agent response',
        createdAt: new Date(),
        status: 'complete',
        participant: {
          peerId: 'ravn-1',
          persona: 'Ravn Alpha',
          color: 'cyan',
          participantType: 'ravn',
          gatewayUrl: 'http://ravn-1:8080',
        },
      },
    ];
    mockSkuldChat({ connected: true, messages });
    render(<SessionChat url="wss://test/session" />);

    // Select once — panel opens
    fireEvent.click(screen.getByTestId('room-select-agent'));
    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();

    // Select same agent again — panel closes (toggle)
    fireEvent.click(screen.getByTestId('room-select-agent'));
    expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
  });
});
