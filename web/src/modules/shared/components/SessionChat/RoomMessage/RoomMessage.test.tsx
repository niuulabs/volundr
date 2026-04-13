import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomMessage } from './RoomMessage';
import type { SkuldChatMessage } from '@/modules/shared/hooks/useSkuldChat';
import { groupContentBlocks } from '../ToolBlock';

// Mock MarkdownContent to keep tests simple and fast
vi.mock('../MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

// Mock ToolBlock/ToolGroupBlock — default returns empty array (no grouped blocks)
vi.mock('../ToolBlock', () => ({
  ToolBlock: ({ block }: { block: { name: string } }) => <div data-testid={`tool-block-${block.name}`} />,
  ToolGroupBlock: ({ toolName }: { toolName: string }) => <div data-testid={`tool-group-${toolName}`} />,
  groupContentBlocks: vi.fn(() => []),
}));

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello from Ravn',
    createdAt: new Date(),
    status: 'complete',
    participant: {
      peerId: 'peer-1',
      persona: 'Ravn-Alpha',
      color: 'amber',
      participantType: 'ravn',
    },
    participantId: 'peer-1',
    ...overrides,
  };
}

describe('RoomMessage', () => {
  beforeEach(() => {
    vi.mocked(groupContentBlocks).mockReturnValue([]);
  });
  it('renders persona label', () => {
    render(<RoomMessage message={makeMessage()} />);
    expect(screen.getByText('Ravn-Alpha')).toBeInTheDocument();
  });

  it('renders markdown content', () => {
    render(<RoomMessage message={makeMessage()} />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.getByTestId('markdown').textContent).toBe('Hello from Ravn');
  });

  it('sets data-participant-color attribute for colored border', () => {
    const { container } = render(<RoomMessage message={makeMessage()} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute('data-participant-color')).toBe('amber');
  });

  it('shows activity dot when participant is thinking', () => {
    render(<RoomMessage message={makeMessage()} participantStatus="thinking" />);
    expect(screen.getByLabelText('Active')).toBeInTheDocument();
  });

  it('shows activity dot when participant is tool_executing', () => {
    render(<RoomMessage message={makeMessage()} participantStatus="tool_executing" />);
    expect(screen.getByLabelText('Active')).toBeInTheDocument();
  });

  it('does not show activity dot when participant is idle', () => {
    render(<RoomMessage message={makeMessage()} participantStatus="idle" />);
    expect(screen.queryByLabelText('Active')).not.toBeInTheDocument();
  });

  it('does not show activity dot when no participantStatus provided', () => {
    render(<RoomMessage message={makeMessage()} />);
    expect(screen.queryByLabelText('Active')).not.toBeInTheDocument();
  });

  it('falls back to "purple" color when no participant color', () => {
    const msg = makeMessage({ participant: undefined, participantId: undefined });
    const { container } = render(<RoomMessage message={msg} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute('data-participant-color')).toBe('purple');
  });

  it('falls back to "Ravn" persona when no participant', () => {
    const msg = makeMessage({ participant: undefined, participantId: undefined });
    render(<RoomMessage message={msg} />);
    expect(screen.getByText('Ravn')).toBeInTheDocument();
  });

  it('renders text segment from groupContentBlocks', () => {
    vi.mocked(groupContentBlocks).mockReturnValue([
      { kind: 'text', text: 'Rendered from parts' },
    ] as ReturnType<typeof groupContentBlocks>);

    const msg = makeMessage({
      parts: [{ type: 'text', text: 'Rendered from parts' }],
    });
    render(<RoomMessage message={msg} />);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Rendered from parts');
  });

  it('skips empty text segments from groupContentBlocks', () => {
    vi.mocked(groupContentBlocks).mockReturnValue([
      { kind: 'text', text: '   ' },
    ] as ReturnType<typeof groupContentBlocks>);

    const msg = makeMessage({
      parts: [{ type: 'text', text: '   ' }],
    });
    const { container } = render(<RoomMessage message={msg} />);
    expect(container.querySelectorAll('[data-testid="markdown"]')).toHaveLength(0);
  });

  it('renders single tool block from groupContentBlocks', () => {
    vi.mocked(groupContentBlocks).mockReturnValue([
      {
        kind: 'single',
        block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} },
        result: undefined,
      },
    ] as ReturnType<typeof groupContentBlocks>);

    const msg = makeMessage({
      parts: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }],
    });
    render(<RoomMessage message={msg} />);
    expect(screen.getByTestId('tool-block-Bash')).toBeInTheDocument();
  });

  it('renders grouped tool blocks from groupContentBlocks', () => {
    vi.mocked(groupContentBlocks).mockReturnValue([
      {
        kind: 'group',
        toolName: 'Read',
        blocks: [],
      },
    ] as ReturnType<typeof groupContentBlocks>);

    const msg = makeMessage({
      parts: [{ type: 'tool_use', id: 'tool-2', name: 'Read', input: {} }],
    });
    render(<RoomMessage message={msg} />);
    expect(screen.getByTestId('tool-group-Read')).toBeInTheDocument();
  });
});
