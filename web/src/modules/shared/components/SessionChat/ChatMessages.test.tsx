import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserMessage, AssistantMessage, StreamingMessage, SystemMessage } from './ChatMessages';
import { groupContentBlocks } from './ToolBlock';
import type { SkuldChatMessage } from '@/modules/shared/hooks/useSkuldChat';
import type { GroupedContent } from './ToolBlock';

/* ------------------------------------------------------------------ */
/*  Mock MarkdownContent — keeps tests focused on ChatMessages logic   */
/* ------------------------------------------------------------------ */

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="rendered-content">{content}</div>
  ),
}));

vi.mock('./ToolBlock', async importOriginal => {
  const actual = await importOriginal<typeof import('./ToolBlock')>();
  return {
    ...actual,
    ToolBlock: ({ block, result }: { block: { name: string }; result?: { content?: string } }) => (
      <div data-testid="tool-block" data-tool-name={block.name}>
        {result?.content && <span data-testid="tool-result">{result.content}</span>}
      </div>
    ),
    ToolGroupBlock: ({ toolName, blocks }: { toolName: string; blocks: unknown[] }) => (
      <div data-testid="tool-group-block" data-tool-name={toolName} data-count={blocks.length} />
    ),
    groupContentBlocks: vi.fn(actual.groupContentBlocks),
  };
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello world',
    createdAt: new Date('2025-01-15T10:30:00'),
    status: 'complete',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Setup / Teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ================================================================== */
/*  UserMessage                                                        */
/* ================================================================== */

describe('UserMessage', () => {
  it('renders message content text', () => {
    const msg = createMessage({ role: 'user', content: 'What is the weather?' });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('What is the weather?')).toBeInTheDocument();
  });

  it('renders timestamp from createdAt', () => {
    const msg = createMessage({ role: 'user', content: 'Hi' });
    render(<UserMessage message={msg} />);

    const formatted = new Date('2025-01-15T10:30:00').toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(screen.getByText(formatted)).toBeInTheDocument();
  });

  it('renders attachments when present (shows name and formatted size)', () => {
    const msg = createMessage({
      role: 'user',
      content: 'See attachment',
      attachments: [
        { name: 'report.pdf', type: 'document', size: 2048, contentType: 'application/pdf' },
      ],
    });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0KB')).toBeInTheDocument();
  });

  it('does not render attachments section when no attachments', () => {
    const msg = createMessage({ role: 'user', content: 'No attachments here' });
    render(<UserMessage message={msg} />);

    expect(screen.queryByText(/(?:KB|MB|B)$/)).not.toBeInTheDocument();
  });

  it('does not render attachments section when attachments array is empty', () => {
    const msg = createMessage({ role: 'user', content: 'Empty array', attachments: [] });
    render(<UserMessage message={msg} />);

    expect(screen.queryByText(/(?:KB|MB|B)$/)).not.toBeInTheDocument();
  });

  it('formats file sizes: bytes < 1024 as XB', () => {
    const msg = createMessage({
      role: 'user',
      content: 'tiny',
      attachments: [{ name: 'a.txt', type: 'text', size: 512, contentType: 'text/plain' }],
    });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('512B')).toBeInTheDocument();
  });

  it('formats file sizes: bytes < 1024*1024 as X.XKB', () => {
    const msg = createMessage({
      role: 'user',
      content: 'medium',
      attachments: [{ name: 'b.txt', type: 'text', size: 5120, contentType: 'text/plain' }],
    });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('5.0KB')).toBeInTheDocument();
  });

  it('formats file sizes: bytes >= 1024*1024 as X.XMB', () => {
    const msg = createMessage({
      role: 'user',
      content: 'large',
      attachments: [
        {
          name: 'c.bin',
          type: 'document',
          size: 2 * 1024 * 1024,
          contentType: 'application/octet-stream',
        },
      ],
    });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('2.0MB')).toBeInTheDocument();
  });

  it('renders multiple attachments', () => {
    const msg = createMessage({
      role: 'user',
      content: 'multi',
      attachments: [
        { name: 'a.txt', type: 'text', size: 100, contentType: 'text/plain' },
        { name: 'b.png', type: 'image', size: 3072, contentType: 'image/png' },
      ],
    });
    render(<UserMessage message={msg} />);

    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('100B')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(screen.getByText('3.0KB')).toBeInTheDocument();
  });
});

/* ================================================================== */
/*  AssistantMessage                                                    */
/* ================================================================== */

describe('AssistantMessage', () => {
  it('renders message content through RenderedContent', () => {
    const msg = createMessage({ content: 'This is the answer.' });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByTestId('rendered-content')).toHaveTextContent('This is the answer.');
  });

  it('renders avatar with hammer icon', () => {
    const msg = createMessage();
    const { container } = render(<AssistantMessage message={msg} />);

    // Lucide renders SVGs; Hammer has a recognizable class
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders model name badge when metadata.usage has keys', () => {
    const msg = createMessage({
      metadata: {
        usage: {
          'claude-sonnet-4-5-20250929': { inputTokens: 100, outputTokens: 50 },
        },
      },
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeInTheDocument();
  });

  it('does not render model badge when no metadata', () => {
    const msg = createMessage({ metadata: undefined });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText(/claude/)).not.toBeInTheDocument();
  });

  it('renders timestamp', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    const formatted = new Date('2025-01-15T10:30:00').toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(screen.getByText(formatted)).toBeInTheDocument();
  });

  it('renders token counts when metadata.usage present', () => {
    const msg = createMessage({
      metadata: {
        usage: {
          'claude-sonnet-4-5-20250929': { inputTokens: 200, outputTokens: 150 },
        },
      },
    });
    render(<AssistantMessage message={msg} />);

    // The component renders: {tokens.input}→{tokens.output} tok
    // The → is rendered as &rarr; (→ character)
    expect(screen.getByText(/200.*150 tok/)).toBeInTheDocument();
  });

  it('renders aggregated token counts across multiple models', () => {
    const msg = createMessage({
      metadata: {
        usage: {
          'model-a': { inputTokens: 100, outputTokens: 50 },
          'model-b': { inputTokens: 200, outputTokens: 100 },
        },
      },
    });
    render(<AssistantMessage message={msg} />);

    // Should sum: 300 input, 150 output
    expect(screen.getByText(/300.*150 tok/)).toBeInTheDocument();
  });

  it('handles missing inputTokens/outputTokens in usage entries gracefully', () => {
    const msg = createMessage({
      metadata: {
        usage: {
          'model-a': {},
        },
      },
    });
    render(<AssistantMessage message={msg} />);

    // Should default to 0 for missing values
    expect(screen.getByText(/0.*0 tok/)).toBeInTheDocument();
  });

  it('does NOT show token info when no metadata.usage', () => {
    const msg = createMessage({ metadata: undefined });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });

  it('does NOT show token info when metadata has no usage', () => {
    const msg = createMessage({ metadata: { cost: 0.01 } });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });

  it('copy button calls onCopy with message content when onCopy provided', () => {
    const onCopy = vi.fn();
    const msg = createMessage({ content: 'Copy me!' });
    render(<AssistantMessage message={msg} onCopy={onCopy} />);

    const copyBtn = screen.getByTitle('Copy');
    fireEvent.click(copyBtn);

    expect(onCopy).toHaveBeenCalledWith('Copy me!');
  });

  it('copy button falls back to navigator.clipboard.writeText when no onCopy', () => {
    const msg = createMessage({ content: 'Clipboard text' });
    render(<AssistantMessage message={msg} />);

    const copyBtn = screen.getByTitle('Copy');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Clipboard text');
  });

  it('copy button shows checkmark briefly after click (title toggles)', () => {
    const msg = createMessage({ content: 'test' });
    render(<AssistantMessage message={msg} />);

    const copyBtn = screen.getByTitle('Copy');
    fireEvent.click(copyBtn);

    // After click, the title should change to 'Copied'
    expect(screen.getByTitle('Copied')).toBeInTheDocument();

    // After 2000ms timeout, it should revert
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTitle('Copy')).toBeInTheDocument();
  });

  it('regenerate button calls onRegenerate with message.id', () => {
    const onRegenerate = vi.fn();
    const msg = createMessage({ id: 'msg-42' });
    render(<AssistantMessage message={msg} onRegenerate={onRegenerate} />);

    const regenBtn = screen.getByTitle('Regenerate');
    fireEvent.click(regenBtn);

    expect(onRegenerate).toHaveBeenCalledWith('msg-42');
  });

  it('hides regenerate button when onRegenerate is not provided', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByTitle('Regenerate')).not.toBeInTheDocument();
  });

  it('ThumbsUp toggle: click once = active, click again = inactive', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    const thumbUp = screen.getByTitle('Helpful');
    expect(thumbUp).toHaveAttribute('data-active', 'false');

    fireEvent.click(thumbUp);
    expect(thumbUp).toHaveAttribute('data-active', 'true');

    fireEvent.click(thumbUp);
    expect(thumbUp).toHaveAttribute('data-active', 'false');
  });

  it('ThumbsDown toggle: click once = active, click again = inactive', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    const thumbDown = screen.getByTitle('Not helpful');
    expect(thumbDown).toHaveAttribute('data-active', 'false');

    fireEvent.click(thumbDown);
    expect(thumbDown).toHaveAttribute('data-active', 'true');

    fireEvent.click(thumbDown);
    expect(thumbDown).toHaveAttribute('data-active', 'false');
  });

  it('ThumbsUp and ThumbsDown are mutually exclusive toggle states', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    const thumbUp = screen.getByTitle('Helpful');
    const thumbDown = screen.getByTitle('Not helpful');

    // Click up
    fireEvent.click(thumbUp);
    expect(thumbUp).toHaveAttribute('data-active', 'true');
    expect(thumbDown).toHaveAttribute('data-active', 'false');

    // Click down switches state from 'up' to 'down'
    fireEvent.click(thumbDown);
    expect(thumbUp).toHaveAttribute('data-active', 'false');
    expect(thumbDown).toHaveAttribute('data-active', 'true');

    // Click down again toggles it off
    fireEvent.click(thumbDown);
    expect(thumbUp).toHaveAttribute('data-active', 'false');
    expect(thumbDown).toHaveAttribute('data-active', 'false');
  });

  it('bookmark toggle: click once = active, click again = inactive', () => {
    const msg = createMessage();
    render(<AssistantMessage message={msg} />);

    const bookmarkBtn = screen.getByTitle('Bookmark');
    expect(bookmarkBtn).toHaveAttribute('data-active', 'false');

    fireEvent.click(bookmarkBtn);
    expect(screen.getByTitle('Remove bookmark')).toHaveAttribute('data-active', 'true');

    fireEvent.click(screen.getByTitle('Remove bookmark'));
    expect(screen.getByTitle('Bookmark')).toHaveAttribute('data-active', 'false');
  });

  it('bookmark toggle calls onBookmark callback with messageId and state', () => {
    const msg = createMessage();
    const onBookmark = vi.fn();
    render(<AssistantMessage message={msg} onBookmark={onBookmark} />);

    fireEvent.click(screen.getByTitle('Bookmark'));
    expect(onBookmark).toHaveBeenCalledWith(msg.id, true);

    fireEvent.click(screen.getByTitle('Remove bookmark'));
    expect(onBookmark).toHaveBeenCalledWith(msg.id, false);
  });

  it('reasoning section: hidden when no reasoning parts', () => {
    const msg = createMessage({ parts: [{ type: 'text', text: 'Just text' }] });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('reasoning section: hidden when parts is undefined', () => {
    const msg = createMessage({ parts: undefined });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('reasoning section: hidden when reasoning parts have empty text', () => {
    const msg = createMessage({
      parts: [{ type: 'reasoning', text: '' }],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
  });

  it('reasoning section: shows "Thinking" trigger when reasoning parts exist', () => {
    const msg = createMessage({
      parts: [{ type: 'reasoning', text: 'Let me think about this...' }],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('reasoning section: collapsed by default (reasoning text not visible)', () => {
    const msg = createMessage({
      parts: [{ type: 'reasoning', text: 'Internal reasoning process' }],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.queryByText('Internal reasoning process')).not.toBeInTheDocument();
  });

  it('reasoning section: clicking trigger expands to show reasoning text', () => {
    const msg = createMessage({
      parts: [{ type: 'reasoning', text: 'Step 1: analyze the input' }],
    });
    render(<AssistantMessage message={msg} />);

    // Initially collapsed
    expect(screen.queryByText('Step 1: analyze the input')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('Thinking'));
    expect(screen.getByText('Step 1: analyze the input')).toBeInTheDocument();
  });

  it('reasoning section: clicking trigger again collapses it', () => {
    const msg = createMessage({
      parts: [{ type: 'reasoning', text: 'Reasoning content here' }],
    });
    render(<AssistantMessage message={msg} />);

    // Expand
    fireEvent.click(screen.getByText('Thinking'));
    expect(screen.getByText('Reasoning content here')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Thinking'));
    expect(screen.queryByText('Reasoning content here')).not.toBeInTheDocument();
  });

  it('reasoning section: renders multiple reasoning parts when expanded', () => {
    const msg = createMessage({
      parts: [
        { type: 'reasoning', text: 'First thought' },
        { type: 'text', text: 'Some text content' },
        { type: 'reasoning', text: 'Second thought' },
      ],
    });
    render(<AssistantMessage message={msg} />);

    fireEvent.click(screen.getByText('Thinking'));

    expect(screen.getByText('First thought')).toBeInTheDocument();
    expect(screen.getByText('Second thought')).toBeInTheDocument();
  });
});

/* ================================================================== */
/*  StreamingMessage                                                    */
/* ================================================================== */

describe('StreamingMessage', () => {
  it('shows bouncing dots and "Thinking..." when content is empty and no reasoning', () => {
    render(<StreamingMessage content="" />);

    // The component renders "Thinking..." twice: once in the header label, once as thinkingLabel
    const thinkingElements = screen.getAllByText('Thinking...');
    expect(thinkingElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Generating..." label and content when content is present', () => {
    render(<StreamingMessage content="Some partial response" />);

    expect(screen.getByText('Generating...')).toBeInTheDocument();
    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Some partial response');
  });

  it('shows model badge when model prop provided (no content, no reasoning)', () => {
    render(<StreamingMessage content="" model="claude-opus-4-6" />);

    expect(screen.getByText('claude-opus-4-6')).toBeInTheDocument();
  });

  it('shows model badge when model prop provided (with content)', () => {
    render(<StreamingMessage content="Output text" model="claude-sonnet-4-5-20250929" />);

    expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeInTheDocument();
  });

  it('does not render model badge when model is not provided', () => {
    render(<StreamingMessage content="" />);

    // No model badge should exist
    expect(screen.queryByText(/claude/)).not.toBeInTheDocument();
  });

  it('renders reasoning inline when parts have reasoning but content is empty', () => {
    const parts = [{ type: 'reasoning' as const, text: 'Working through the problem...' }];
    render(<StreamingMessage content="" parts={parts} />);

    expect(screen.getByText('Working through the problem...')).toBeInTheDocument();
  });

  it('shows "Thinking..." label when only reasoning is streaming', () => {
    const parts = [{ type: 'reasoning' as const, text: 'Deep analysis' }];
    render(<StreamingMessage content="" parts={parts} />);

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('shows model badge when reasoning is streaming with model', () => {
    const parts = [{ type: 'reasoning' as const, text: 'Analyzing...' }];
    render(<StreamingMessage content="" parts={parts} model="claude-opus-4-6" />);

    expect(screen.getByText('claude-opus-4-6')).toBeInTheDocument();
  });

  it('renders multiple reasoning parts when no content', () => {
    const parts = [
      { type: 'reasoning' as const, text: 'First reasoning block' },
      { type: 'reasoning' as const, text: 'Second reasoning block' },
    ];
    render(<StreamingMessage content="" parts={parts} />);

    expect(screen.getByText('First reasoning block')).toBeInTheDocument();
    expect(screen.getByText('Second reasoning block')).toBeInTheDocument();
  });

  it('filters out non-reasoning parts and empty reasoning when checking hasReasoning', () => {
    const parts = [
      { type: 'text' as const, text: 'text part' },
      { type: 'reasoning' as const, text: '' },
    ];
    render(<StreamingMessage content="" parts={parts} />);

    // Should fall through to the empty-content branch (dots) because
    // text parts are not reasoning and empty reasoning text is filtered out
    const thinkingElements = screen.getAllByText('Thinking...');
    expect(thinkingElements.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show dots when content is present', () => {
    render(<StreamingMessage content="Some text" />);

    // Dots are rendered as spans with dot class; with content there should be none
    // We just verify "Generating..." is shown instead of "Thinking..."
    expect(screen.getByText('Generating...')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('renders with undefined parts (no crash)', () => {
    render(<StreamingMessage content="" parts={undefined} />);

    // Should show the dots / Thinking state
    const thinkingElements = screen.getAllByText('Thinking...');
    expect(thinkingElements.length).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/*  SystemMessage                                                      */
/* ================================================================== */

describe('SystemMessage', () => {
  it('renders terminal icon and message content', () => {
    const msg = createMessage({ role: 'system', content: 'Session initialized' });
    const { container } = render(<SystemMessage message={msg} />);

    // Terminal icon (SVG) should be present
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('shows content text', () => {
    const msg = createMessage({
      role: 'system',
      content: 'System configuration updated',
    });
    render(<SystemMessage message={msg} />);

    expect(screen.getByText('System configuration updated')).toBeInTheDocument();
  });

  it('renders different system messages', () => {
    const msg = createMessage({
      role: 'system',
      content: 'Connection lost - reconnecting...',
    });
    render(<SystemMessage message={msg} />);

    expect(screen.getByText('Connection lost - reconnecting...')).toBeInTheDocument();
  });
});

/* ================================================================== */
/*  partsToContentBlocks — branch coverage                             */
/* ================================================================== */

describe('partsToContentBlocks (via AssistantMessage)', () => {
  const mockedGroupContentBlocks = vi.mocked(groupContentBlocks);

  afterEach(() => {
    mockedGroupContentBlocks.mockRestore();
  });

  it('filters out reasoning-only parts, resulting in empty blocks and fallback markdown', () => {
    // Message with only reasoning parts — partsToContentBlocks should produce []
    // Since there is a tool_use part, hasToolParts returns true, but the blocks will be empty
    // after reasoning is filtered. We need at least one tool_use for hasToolParts to be true.
    // Actually, reasoning-only means no tool_use parts, so hasToolParts returns false
    // and MarkdownContent is rendered directly.
    const msg = createMessage({
      content: 'Fallback content',
      parts: [
        { type: 'reasoning', text: 'Internal thought process' },
        { type: 'reasoning', text: 'More reasoning' },
      ],
    });
    render(<AssistantMessage message={msg} />);

    // No tool_use parts means hasToolParts=false, so MarkdownContent renders the content
    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Fallback content');
  });

  it('converts text parts to content blocks', () => {
    // Need tool_use to trigger AssistantContentWithTools path
    const msg = createMessage({
      content: 'fallback',
      parts: [
        { type: 'text', text: 'Hello from text' },
        { type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } },
      ],
    });
    render(<AssistantMessage message={msg} />);

    // The text part becomes a MarkdownContent, the tool_use becomes a ToolBlock
    expect(screen.getByText('Hello from text')).toBeInTheDocument();
    expect(screen.getByTestId('tool-block')).toBeInTheDocument();
  });

  it('converts tool_result parts and attaches to preceding tool_use', () => {
    const msg = createMessage({
      content: 'fallback',
      parts: [
        { type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } },
        { type: 'tool_result', tool_use_id: 'tu-1', content: 'file1.txt\nfile2.txt' },
      ],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-name', 'bash');
    expect(screen.getByTestId('tool-result')).toHaveTextContent('file1.txt file2.txt');
  });

  it('mixes reasoning, text, tool_use and tool_result — reasoning filtered out', () => {
    const msg = createMessage({
      content: 'fallback',
      parts: [
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text', text: 'Here is the result:' },
        { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: '/tmp/x' } },
        { type: 'tool_result', tool_use_id: 'tu-1', content: 'file contents' },
        { type: 'reasoning', text: 'Now process the result' },
      ],
    });
    render(<AssistantMessage message={msg} />);

    // Text part rendered
    expect(screen.getByText('Here is the result:')).toBeInTheDocument();
    // Tool block rendered
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-name', 'read_file');
    expect(screen.getByTestId('tool-result')).toHaveTextContent('file contents');
  });
});

/* ================================================================== */
/*  AssistantContentWithTools — branch coverage                        */
/* ================================================================== */

describe('AssistantContentWithTools edge cases (via AssistantMessage)', () => {
  const mockedGroupContentBlocks = vi.mocked(groupContentBlocks);

  afterEach(() => {
    mockedGroupContentBlocks.mockRestore();
  });

  it('falls back to MarkdownContent when grouped.length === 0', () => {
    // Force groupContentBlocks to return empty array
    mockedGroupContentBlocks.mockReturnValueOnce([]);

    const msg = createMessage({
      content: 'Fallback markdown content',
      parts: [{ type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } }],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Fallback markdown content');
  });

  it('renders text-kind grouped items (skipping whitespace-only)', () => {
    mockedGroupContentBlocks.mockReturnValueOnce([
      { kind: 'text', text: '   ' } as GroupedContent,
      { kind: 'text', text: 'Visible text' } as GroupedContent,
    ]);

    const msg = createMessage({
      content: 'fallback',
      parts: [{ type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } }],
    });
    render(<AssistantMessage message={msg} />);

    // Whitespace-only text should not be rendered; only the visible text
    const contents = screen.getAllByTestId('rendered-content');
    expect(contents).toHaveLength(1);
    expect(contents[0]).toHaveTextContent('Visible text');
  });

  it('renders single-kind grouped items as ToolBlock', () => {
    mockedGroupContentBlocks.mockReturnValueOnce([
      {
        kind: 'single',
        block: { type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: '/tmp/x' } },
        result: { type: 'tool_result', tool_use_id: 'tu-1', content: 'done' },
      } as GroupedContent,
    ]);

    const msg = createMessage({
      content: 'fallback',
      parts: [{ type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: '/tmp/x' } }],
    });
    render(<AssistantMessage message={msg} />);

    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-name', 'write_file');
  });

  it('renders group-kind grouped items as ToolGroupBlock', () => {
    mockedGroupContentBlocks.mockReturnValueOnce([
      {
        kind: 'group',
        toolName: 'bash',
        blocks: [
          { block: { type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } } },
          { block: { type: 'tool_use', id: 'tu-2', name: 'bash', input: { command: 'pwd' } } },
        ],
      } as GroupedContent,
    ]);

    const msg = createMessage({
      content: 'fallback',
      parts: [{ type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } }],
    });
    render(<AssistantMessage message={msg} />);

    const groupBlock = screen.getByTestId('tool-group-block');
    expect(groupBlock).toHaveAttribute('data-tool-name', 'bash');
    expect(groupBlock).toHaveAttribute('data-count', '2');
  });

  it('returns null for unknown kind values in grouped content', () => {
    mockedGroupContentBlocks.mockReturnValueOnce([
      { kind: 'unknown_kind' } as unknown as GroupedContent,
    ]);

    const msg = createMessage({
      content: 'fallback',
      parts: [{ type: 'tool_use', id: 'tu-1', name: 'bash', input: { command: 'ls' } }],
    });
    render(<AssistantMessage message={msg} />);

    // Unknown kind should render nothing (returns null)
    expect(screen.queryByTestId('tool-block')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-group-block')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rendered-content')).not.toBeInTheDocument();
  });

  it('AssistantMessage with empty parts array renders MarkdownContent', () => {
    const msg = createMessage({
      content: 'Just plain text',
      parts: [],
    });
    render(<AssistantMessage message={msg} />);

    // Empty parts means hasToolParts returns false
    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Just plain text');
  });
});

/* ================================================================== */
/*  StreamingMessage with tools — branch coverage                      */
/* ================================================================== */

describe('StreamingMessage with tool parts', () => {
  const mockedGroupContentBlocks = vi.mocked(groupContentBlocks);

  afterEach(() => {
    mockedGroupContentBlocks.mockRestore();
  });

  it('renders AssistantContentWithTools when content present and parts have tool_use', () => {
    const parts = [
      { type: 'tool_use' as const, id: 'tu-1', name: 'bash', input: { command: 'ls' } },
      { type: 'tool_result' as const, tool_use_id: 'tu-1', content: 'output.txt' },
    ];
    render(<StreamingMessage content="Running commands..." parts={parts} />);

    expect(screen.getByText('Generating...')).toBeInTheDocument();
    expect(screen.getByTestId('tool-block')).toHaveAttribute('data-tool-name', 'bash');
  });

  it('renders MarkdownContent when content present but no tool_use parts', () => {
    const parts = [{ type: 'text' as const, text: 'just text' }];
    render(<StreamingMessage content="Some response" parts={parts} />);

    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Some response');
  });

  it('renders tools with fallback content when groupContentBlocks returns empty', () => {
    mockedGroupContentBlocks.mockReturnValueOnce([]);

    const parts = [
      { type: 'tool_use' as const, id: 'tu-1', name: 'bash', input: { command: 'ls' } },
    ];
    render(<StreamingMessage content="Fallback streaming content" parts={parts} />);

    // Empty grouped -> falls back to MarkdownContent with fallbackContent
    expect(screen.getByTestId('rendered-content')).toHaveTextContent('Fallback streaming content');
  });

  it('renders dots when content is empty and parts have tools but no reasoning', () => {
    const parts = [
      { type: 'tool_use' as const, id: 'tu-1', name: 'bash', input: { command: 'ls' } },
    ];
    render(<StreamingMessage content="" parts={parts} />);

    // No content and no reasoning -> shows dots/Thinking
    const thinkingElements = screen.getAllByText('Thinking...');
    expect(thinkingElements.length).toBeGreaterThanOrEqual(1);
  });
});
