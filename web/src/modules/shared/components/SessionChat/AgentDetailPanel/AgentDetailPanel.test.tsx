import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AgentDetailPanel } from './AgentDetailPanel';
import type { ParticipantMeta, SkuldChatMessage } from '@/modules/shared/hooks/useSkuldChat';

// ── Mock useAgentDetail ───────────────────────────────────────────────

vi.mock('@/modules/shared/hooks/useAgentDetail', () => ({
  useAgentDetail: vi.fn(),
}));

// ── Mock child message components ─────────────────────────────────────

vi.mock('../ChatMessages', () => ({
  AssistantMessage: ({ message }: { message: SkuldChatMessage }) => (
    <div data-testid="assistant-message">{message.content}</div>
  ),
  StreamingMessage: ({ content }: { content: string }) => (
    <div data-testid="streaming-message">{content}</div>
  ),
  SystemMessage: ({ message }: { message: SkuldChatMessage }) => (
    <div data-testid="system-message">{message.content}</div>
  ),
  UserMessage: ({ message }: { message: SkuldChatMessage }) => (
    <div data-testid="user-message">{message.content}</div>
  ),
}));

import { useAgentDetail } from '@/modules/shared/hooks/useAgentDetail';

// ── Helpers ───────────────────────────────────────────────────────────

function makeParticipant(overrides: Partial<ParticipantMeta> = {}): ParticipantMeta {
  return {
    peerId: 'ravn-1',
    persona: 'Ravn Alpha',
    color: 'cyan',
    participantType: 'ravn',
    gatewayUrl: 'http://ravn-1:8080',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Thinking about it',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

function setupDetailMock(options: {
  messages?: SkuldChatMessage[];
  connected?: boolean;
  isRunning?: boolean;
} = {}) {
  vi.mocked(useAgentDetail).mockReturnValue({
    messages: options.messages ?? [],
    connected: options.connected ?? false,
    isRunning: options.isRunning ?? false,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AgentDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Header', () => {
    it('renders persona name', () => {
      setupDetailMock();
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Ravn Alpha');
    });

    it('renders close button', () => {
      setupDetailMock();
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-close')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={makeParticipant()} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('agent-detail-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={makeParticipant()} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows idle activity status when not running', () => {
      setupDetailMock({ isRunning: false });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('idle');
    });

    it('shows thinking activity status when running', () => {
      setupDetailMock({ isRunning: true });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('thinking');
    });
  });

  describe('Message rendering', () => {
    it('shows empty state when no messages and disconnected', () => {
      setupDetailMock({ messages: [], connected: false });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-empty')).toBeInTheDocument();
    });

    it('shows connecting message in empty state when disconnected', () => {
      setupDetailMock({ messages: [], connected: false });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-empty')).toHaveTextContent('Connecting to agent');
    });

    it('shows waiting message in empty state when connected', () => {
      setupDetailMock({ messages: [], connected: true });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-empty')).toHaveTextContent('Waiting for agent');
    });

    it('renders assistant messages', () => {
      const msg = makeMessage({ role: 'assistant', content: 'I have a plan', status: 'complete' });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('assistant-message')).toHaveTextContent('I have a plan');
    });

    it('renders streaming messages for running status', () => {
      const msg = makeMessage({ role: 'assistant', content: 'Still thinking', status: 'running' });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    });

    it('renders user messages', () => {
      const msg = makeMessage({ role: 'user', content: 'Go do the task', status: 'complete' });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('user-message')).toHaveTextContent('Go do the task');
    });

    it('filters out empty complete assistant messages', () => {
      const msg = makeMessage({ role: 'assistant', content: '   ', status: 'complete' });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.queryByTestId('assistant-message')).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-detail-empty')).toBeInTheDocument();
    });

    it('filters out system role messages', () => {
      const msg = makeMessage({ role: 'system', content: 'Session started', status: 'complete' });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      // System role messages are filtered out entirely (not shown as system messages)
      expect(screen.queryByTestId('system-message')).not.toBeInTheDocument();
    });

    it('renders system metadata messages with SystemMessage component', () => {
      const msg = makeMessage({
        role: 'assistant',
        content: 'hook event',
        status: 'complete',
        metadata: { messageType: 'system' },
      });
      setupDetailMock({ messages: [msg] });
      render(<AgentDetailPanel participant={makeParticipant()} onClose={vi.fn()} />);
      expect(screen.getByTestId('system-message')).toBeInTheDocument();
    });
  });

  describe('with different participant colors', () => {
    it('renders the panel for amber participants', () => {
      setupDetailMock();
      const participant = makeParticipant({ color: 'amber', persona: 'Amber Agent' });
      render(<AgentDetailPanel participant={participant} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Amber Agent');
    });

    it('renders the panel for participants with unknown colors', () => {
      setupDetailMock();
      const participant = makeParticipant({ color: 'unknown-color', persona: 'Mystery Agent' });
      render(<AgentDetailPanel participant={participant} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Mystery Agent');
    });
  });
});
