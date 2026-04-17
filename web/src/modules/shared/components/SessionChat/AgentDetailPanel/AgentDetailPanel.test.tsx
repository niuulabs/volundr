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

function _makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
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
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Ravn Alpha');
    });

    it('renders close button', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-detail-close')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
      fireEvent.click(screen.getByTestId('agent-detail-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when Escape is pressed inside an input', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
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
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      fireEvent.keyDown(textarea, { key: 'Escape', target: textarea });
      expect(onClose).not.toHaveBeenCalled();
      document.body.removeChild(textarea);
    });

    it('shows idle activity status when not running', () => {
      setupDetailMock({ isRunning: false });
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('idle');
    });

    it('shows thinking activity status', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'thinking' as const, joinedAt: new Date() }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('thinking');
    });

    it('shows running tool activity status', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{
            ...makeParticipant(),
            status: 'tool_executing' as const,
            joinedAt: new Date(),
          }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('running tool');
    });

    it('shows raw status for unknown status values', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{
            ...makeParticipant(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            status: 'custom_status' as any,
            joinedAt: new Date(),
          }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('custom_status');
    });

    it('shows displayName with persona when displayName is set', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{
            ...makeParticipant({ displayName: 'Alpha Bot', persona: 'Ravn Alpha' }),
            status: 'idle' as const,
            joinedAt: new Date(),
          }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Alpha Bot (Ravn Alpha)');
    });

    it('does not call onClose for non-Escape keys', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose when Escape is pressed inside a select', () => {
      setupDetailMock();
      const onClose = vi.fn();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={onClose}
        />
      );
      const select = document.createElement('select');
      document.body.appendChild(select);
      select.focus();
      fireEvent.keyDown(select, { key: 'Escape', target: select });
      expect(onClose).not.toHaveBeenCalled();
      document.body.removeChild(select);
    });
  });

  describe('Event rendering', () => {
    it('shows empty state when no events', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('agent-detail-empty')).toBeInTheDocument();
    });

    it('renders thought events', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-1',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'thought',
              data: 'I should check the file',
              metadata: {},
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('thinking')).toBeInTheDocument();
      expect(screen.getByText('I should check the file')).toBeInTheDocument();
    });

    it('renders thought events with object data', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-1',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'thought',
              data: { reasoning: 'complex' },
              metadata: {},
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('thinking')).toBeInTheDocument();
    });

    it('renders tool_start events with tool_name metadata', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-2',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_start',
              data: 'Read',
              metadata: { tool_name: 'Read', input: '/path/to/file' },
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('tool: Read')).toBeInTheDocument();
      expect(screen.getByText('/path/to/file')).toBeInTheDocument();
    });

    it('renders tool_start events without tool_name', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-2',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_start',
              data: 'Bash',
              metadata: {},
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('tool: Bash')).toBeInTheDocument();
    });

    it('renders tool_start events with object input', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-2',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_start',
              data: 'Edit',
              metadata: { tool_name: 'Edit', input: { file: 'main.ts', line: 42 } },
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('tool: Edit')).toBeInTheDocument();
    });

    it('renders tool_start events without input', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-2',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_start',
              data: 'Grep',
              metadata: { tool_name: 'Grep' },
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('tool: Grep')).toBeInTheDocument();
    });

    it('renders tool_result events with tool_name', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-3',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_result',
              data: 'File contents here',
              metadata: { tool_name: 'Read' },
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('result: Read')).toBeInTheDocument();
      expect(screen.getByText('File contents here')).toBeInTheDocument();
    });

    it('renders tool_result events without tool_name', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-3',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'tool_result',
              data: 'output',
              metadata: {},
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('result:')).toBeInTheDocument();
    });

    it('renders unknown frameType events with fallback', () => {
      setupDetailMock();
      render(
        <AgentDetailPanel
          participant={{ ...makeParticipant(), status: 'idle' as const, joinedAt: new Date() }}
          events={[
            {
              id: 'evt-4',
              participantId: 'ravn-1',
              timestamp: new Date(),
              frameType: 'custom_frame',
              data: 'some data',
              metadata: {},
            },
          ]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('custom_frame')).toBeInTheDocument();
      expect(screen.getByText('some data')).toBeInTheDocument();
    });
  });

  describe('with different participant colors', () => {
    it('renders the panel for amber participants', () => {
      setupDetailMock();
      const participant = {
        ...makeParticipant({ color: 'amber', persona: 'Amber Agent' }),
        status: 'idle' as const,
        joinedAt: new Date(),
      };
      render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Amber Agent');
    });

    it('renders the panel for participants with unknown colors', () => {
      setupDetailMock();
      const participant = {
        ...makeParticipant({ color: 'unknown-color', persona: 'Mystery Agent' }),
        status: 'idle' as const,
        joinedAt: new Date(),
      };
      render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Mystery Agent');
    });
  });
});
