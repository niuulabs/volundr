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
    displayName: '',
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

function setupDetailMock(
  options: {
    messages?: SkuldChatMessage[];
    connected?: boolean;
    isRunning?: boolean;
  } = {}
) {
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
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Ravn Alpha');
    });

    it('renders close button', () => {
      setupDetailMock();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-close')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('agent-detail-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when Escape is pressed inside an input', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={onClose} />);
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      fireEvent.keyDown(input, { key: 'Escape', target: input });
      expect(onClose).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('does not call onClose when Escape is pressed inside a textarea', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={onClose} />);
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      fireEvent.keyDown(textarea, { key: 'Escape', target: textarea });
      expect(onClose).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });

    it('shows idle activity status when not running', () => {
      setupDetailMock({ isRunning: false });
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('idle');
    });

    it('shows thinking activity status', () => {
      setupDetailMock();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'thinking' as const, joinedAt: new Date()}} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('thinking');
    });
  });

  describe('Event rendering', () => {
    it('shows empty state when no events', () => {
      setupDetailMock();
      render(<AgentDetailPanel participant={{...makeParticipant(), status: 'idle' as const, joinedAt: new Date()}} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-detail-empty')).toBeInTheDocument();
    });
  });

  describe('with different participant colors', () => {
    it('renders the panel for amber participants', () => {
      setupDetailMock();
      const participant = { ...makeParticipant({ color: 'amber', persona: 'Amber Agent' }), status: 'idle' as const, joinedAt: new Date() };
      render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Amber Agent');
    });

    it('renders the panel for participants with unknown colors', () => {
      setupDetailMock();
      const participant = { ...makeParticipant({ color: 'unknown-color', persona: 'Mystery Agent' }), status: 'idle' as const, joinedAt: new Date() };
      render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Mystery Agent');
    });
  });
});
