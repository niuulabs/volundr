import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RenderedContent, CodeBlock } from './RenderedContent';

vi.mock('./RenderedContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));

// Mock clipboard
const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: writeTextMock },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  writeTextMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RenderedContent', () => {
  it('renders plain text as a paragraph', () => {
    render(<RenderedContent content="Hello, world!" />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders bold text with strong element', () => {
    render(<RenderedContent content="This is **bold** text" />);
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('renders a fenced code block with language label', () => {
    const content = '```typescript\nconst x = 1;\n```';
    render(<RenderedContent content={content} />);
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders a fenced code block without language as "text"', () => {
    const content = '```\nsome code\n```';
    render(<RenderedContent content={content} />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('renders a bullet list', () => {
    const content = '- item one\n- item two\n- item three';
    render(<RenderedContent content={content} />);
    expect(screen.getByText('item one')).toBeInTheDocument();
    expect(screen.getByText('item two')).toBeInTheDocument();
    expect(screen.getByText('item three')).toBeInTheDocument();
  });
});

describe('CodeBlock', () => {
  it('shows language label', () => {
    render(<CodeBlock language="python" code="print('hi')" />);
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('shows code content', () => {
    render(<CodeBlock language="bash" code="echo hello" />);
    expect(screen.getByText('echo hello')).toBeInTheDocument();
  });

  it('shows "text" when language is empty', () => {
    render(<CodeBlock language="" code="some code" />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('copy button calls navigator.clipboard.writeText with code', async () => {
    render(<CodeBlock language="bash" code="ls -la" />);
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('ls -la');
  });

  it('copy button shows "Copied!" feedback after click', async () => {
    render(<CodeBlock language="bash" code="ls -la" />);
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
      // Allow clipboard promise to resolve
      await Promise.resolve();
    });
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('copy button reverts after 2 seconds', async () => {
    render(<CodeBlock language="bash" code="ls -la" />);
    const copyBtn = screen.getByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});
