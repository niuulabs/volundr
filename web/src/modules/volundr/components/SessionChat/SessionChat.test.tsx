import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the useSkuldChat hook
vi.mock('@/modules/volundr/hooks/useSkuldChat', () => ({
  useSkuldChat: vi.fn(),
}));

import { useSkuldChat } from '@/modules/volundr/hooks/useSkuldChat';
import type { SkuldChatMessage, PermissionRequest } from '@/modules/volundr/hooks/useSkuldChat';
import { SessionChat } from './SessionChat';

function mockSkuldChat(overrides: Partial<ReturnType<typeof useSkuldChat>> = {}) {
  const defaults: ReturnType<typeof useSkuldChat> = {
    messages: [],
    connected: false,
    isRunning: false,
    pendingPermissions: [],
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
});
