import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MarkdownContent', () => {
  it('renders plain text as a paragraph', () => {
    render(<MarkdownContent content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders headings', () => {
    render(<MarkdownContent content={'# Heading 1\n\n## Heading 2\n\n### Heading 3'} />);
    expect(screen.getByText('Heading 1')).toBeInTheDocument();
    expect(screen.getByText('Heading 2')).toBeInTheDocument();
    expect(screen.getByText('Heading 3')).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    render(<MarkdownContent content="**bold** and *italic*" />);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownContent content="Use `const x = 1` here" />);
    expect(screen.getByText('const x = 1')).toBeInTheDocument();
  });

  it('renders fenced code block with language and copy button', () => {
    const md = '```javascript\nconsole.log("hi");\n```';
    render(<MarkdownContent content={md} />);

    expect(screen.getByText('javascript')).toBeInTheDocument();
    expect(screen.getByText('console.log("hi");')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('renders fenced code block without language', () => {
    const md = '```\nsome code\n```';
    render(<MarkdownContent content={md} />);

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('some code')).toBeInTheDocument();
  });

  it('copy button copies code to clipboard', async () => {
    const md = '```js\nconst x = 1;\n```';
    render(<MarkdownContent content={md} />);

    const copyBtn = screen.getByText('Copy');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('copy button shows "Copied!" after click and resets', async () => {
    const md = '```js\nconst x = 1;\n```';
    render(<MarkdownContent content={md} />);

    const copyBtn = screen.getByText('Copy');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText('Copied!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('renders unordered and ordered lists', () => {
    const md = '- item 1\n- item 2\n\n1. first\n2. second';
    render(<MarkdownContent content={md} />);

    expect(screen.getByText('item 1')).toBeInTheDocument();
    expect(screen.getByText('item 2')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders links with target=_blank', () => {
    render(<MarkdownContent content="[click here](https://example.com)" />);

    const link = screen.getByText('click here');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com');
  });

  it('renders blockquotes', () => {
    render(<MarkdownContent content="> This is a quote" />);
    expect(screen.getByText('This is a quote')).toBeInTheDocument();
  });

  it('renders horizontal rules', () => {
    const { container } = render(<MarkdownContent content={'above\n\n---\n\nbelow'} />);
    expect(container.querySelector('hr')).toBeInTheDocument();
  });

  it('renders tables (GFM)', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    render(<MarkdownContent content={md} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows streaming cursor when isStreaming is true', () => {
    const { container } = render(<MarkdownContent content="text" isStreaming />);
    const cursor = container.querySelector('[class*="streamingCursor"]');
    expect(cursor).toBeInTheDocument();
  });

  it('does not show streaming cursor when isStreaming is false', () => {
    const { container } = render(<MarkdownContent content="text" />);
    const cursor = container.querySelector('[class*="streamingCursor"]');
    expect(cursor).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<MarkdownContent content="text" className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
