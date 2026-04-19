import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  UserMessage,
  AssistantMessage,
  StreamingMessage,
  SystemMessage,
} from './ChatMessages';
import type { SkuldChatMessage } from '../types';

vi.mock('./ChatMessages.module.css', () => ({ default: {} }));
vi.mock('../MarkdownContent/MarkdownContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));
vi.mock('../ToolBlock/ToolBlock.module.css', () => ({ default: {} }));

vi.mock('../MarkdownContent/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

vi.mock('../ToolBlock/ToolBlock', () => ({
  ToolBlock: () => <div data-testid="tool-block" />,
}));

vi.mock('../ToolBlock/ToolGroupBlock', () => ({
  ToolGroupBlock: () => <div data-testid="tool-group-block" />,
}));

vi.mock('../ToolBlock/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ToolBlock')>();
  return {
    ...original,
    ToolBlock: () => <div data-testid="tool-block" />,
    ToolGroupBlock: () => <div data-testid="tool-group-block" />,
  };
});

vi.mock('lucide-react', () => ({
  Hammer: () => null,
  Copy: () => null,
  Check: () => null,
  RefreshCw: () => null,
  ThumbsUp: () => null,
  ThumbsDown: () => null,
  ChevronRight: () => null,
  ChevronDown: () => null,
  Loader2: () => null,
  Terminal: () => <span>Terminal</span>,
  Paperclip: () => null,
  Bookmark: () => null,
  // icons used by ToolIcon (loaded via importOriginal in ToolBlock/index mock)
  FileText: () => null,
  FilePlus: () => null,
  FileEdit: () => null,
  Search: () => null,
  Globe: () => null,
  Bot: () => null,
  ListChecks: () => null,
  Wrench: () => null,
}));

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Default content',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

describe('UserMessage', () => {
  it('shows user content', () => {
    const message = makeMessage({ role: 'user', content: 'Hello agent!' });
    render(<UserMessage message={message} />);
    expect(screen.getByText('Hello agent!')).toBeInTheDocument();
  });

  it('shows attachment names when present', () => {
    const message = makeMessage({
      role: 'user',
      content: 'With attachment',
      attachments: [{ name: 'photo.jpg', type: 'image', size: 1024, contentType: 'image/jpeg' }],
    });
    render(<UserMessage message={message} />);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });
});

describe('AssistantMessage', () => {
  it('renders markdown content', () => {
    const message = makeMessage({ content: 'This is the response' });
    render(<AssistantMessage message={message} />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.getByText('This is the response')).toBeInTheDocument();
  });

  it('shows tool blocks when parts include tool_use', () => {
    const message = makeMessage({
      content: 'Result',
      parts: [
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1' },
      ],
    });
    render(<AssistantMessage message={message} />);
    expect(screen.getByTestId('tool-block')).toBeInTheDocument();
  });

  it('renders model badge when metadata.usage is set', () => {
    const message = makeMessage({
      metadata: {
        usage: {
          'claude-3-5-sonnet': { inputTokens: 100, outputTokens: 50 },
        },
      },
    });
    render(<AssistantMessage message={message} />);
    expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument();
  });
});

describe('StreamingMessage', () => {
  it('shows streaming content when content is non-empty', () => {
    render(<StreamingMessage content="Generating response..." />);
    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });

  it('shows "Generating..." label when content is present', () => {
    render(<StreamingMessage content="some content" />);
    expect(screen.getByText('Generating...')).toBeInTheDocument();
  });

  it('shows "Thinking..." when content is empty and no reasoning', () => {
    render(<StreamingMessage content="" />);
    expect(screen.getAllByText('Thinking...').length).toBeGreaterThan(0);
  });

  it('shows reasoning content when reasoning parts exist but no text content', () => {
    render(
      <StreamingMessage
        content=""
        parts={[{ type: 'reasoning', text: 'Thinking about the problem...' }]}
      />
    );
    expect(screen.getByText('Thinking about the problem...')).toBeInTheDocument();
  });
});

describe('SystemMessage', () => {
  it('shows system content', () => {
    const message = makeMessage({ role: 'system', content: 'System initialized' });
    render(<SystemMessage message={message} />);
    expect(screen.getByText('System initialized')).toBeInTheDocument();
  });

  it('renders terminal icon', () => {
    const message = makeMessage({ role: 'system', content: 'System message' });
    render(<SystemMessage message={message} />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });
});
