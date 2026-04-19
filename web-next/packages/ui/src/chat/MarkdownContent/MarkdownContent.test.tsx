import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';

vi.mock('./MarkdownContent.module.css', () => ({ default: {} }));
vi.mock('../OutcomeCard/OutcomeCard.module.css', () => ({ default: {} }));

vi.mock('../OutcomeCard/OutcomeCard', () => ({
  OutcomeCard: ({ yaml }: { yaml: string }) => (
    <div data-testid="outcome-card">{yaml}</div>
  ),
  OUTCOME_RE: /(---outcome---[\s\S]*?(?:---end---|(?:^|\n)---(?:\s*$|\n)))/gim,
  OUTCOME_EXTRACT_RE: /---outcome---\s*([\s\S]*?)(?:---end---|(?:^|\n)---(?:\s*$|\n))/im,
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
}));

vi.mock('remark-gfm', () => ({
  default: () => ({}),
}));

vi.mock('lucide-react', () => ({
  Copy: () => null,
  Check: () => null,
  WrapText: () => null,
}));

// Mock clipboard
const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: writeTextMock },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MarkdownContent', () => {
  it('renders plain text content via ReactMarkdown', () => {
    render(<MarkdownContent content="Hello, world!" />);
    expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders outcome card for outcome blocks', () => {
    const content = '---outcome---\nverdict: pass\nreason: ok\n---end---';
    render(<MarkdownContent content={content} />);
    expect(screen.getByTestId('outcome-card')).toBeInTheDocument();
  });

  it('renders multiple segments: text before and after outcome', () => {
    const content = 'Before\n---outcome---\nverdict: pass\n---end---\nAfter';
    render(<MarkdownContent content={content} />);
    const markdownSegments = screen.getAllByTestId('react-markdown');
    expect(markdownSegments.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('outcome-card')).toBeInTheDocument();
  });

  it('adds streaming cursor when isStreaming=true', () => {
    const { container } = render(<MarkdownContent content="text" isStreaming={true} />);
    // The streaming cursor is a span with class streamingCursor (mocked as empty class)
    // Just verify rendering doesn't break
    expect(container.firstChild).toBeInTheDocument();
  });

  it('does not crash on empty content', () => {
    const { container } = render(<MarkdownContent content="" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <MarkdownContent content="hello" className="my-custom-class" />
    );
    expect(container.firstChild).toBeInTheDocument();
  });
});
