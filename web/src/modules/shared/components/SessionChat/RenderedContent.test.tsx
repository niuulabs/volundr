import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RenderedContent, CodeBlock } from './RenderedContent';

/* ------------------------------------------------------------------ */
/*  Clipboard mock                                                     */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

/* ================================================================== */
/*  CodeBlock                                                          */
/* ================================================================== */

describe('CodeBlock', () => {
  it('renders the language label', () => {
    render(<CodeBlock language="typescript" code="const x = 1;" />);

    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('renders code content in a pre tag', () => {
    render(<CodeBlock language="python" code="print('hello')" />);

    const pre = screen.getByText("print('hello')");
    expect(pre.tagName).toBe('PRE');
  });

  it('shows "text" as language when language is empty string', () => {
    render(<CodeBlock language="" code="plain content" />);

    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('shows "Copy" button initially', () => {
    render(<CodeBlock language="js" code="let a = 1;" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('copies code to clipboard and shows "Copied!" on click', async () => {
    render(<CodeBlock language="js" code="let a = 1;" />);

    fireEvent.click(screen.getByText('Copy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('let a = 1;');

    // Wait for the promise to resolve and state to update
    await screen.findByText('Copied!');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('reverts back to "Copy" after timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CodeBlock language="js" code="let a = 1;" />);

    fireEvent.click(screen.getByText('Copy'));

    // Wait for the clipboard promise to resolve and state to update
    await screen.findByText('Copied!');
    expect(screen.getByText('Copied!')).toBeInTheDocument();

    // Advance past the 2000ms setTimeout, wrapped in act for React state update
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders the copy icon SVG (not-copied state)', () => {
    const { container } = render(<CodeBlock language="js" code="x" />);

    // The not-copied state has a rect and a path (two child elements)
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelector('rect')).not.toBeNull();
    expect(svg!.querySelector('path')).not.toBeNull();
  });

  it('renders checkmark SVG after copy', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<CodeBlock language="js" code="x" />);

    fireEvent.click(screen.getByText('Copy'));
    await screen.findByText('Copied!');

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Copied state has only a single path (checkmark), no rect
    expect(svg!.querySelector('rect')).toBeNull();
    expect(svg!.querySelector('path')).not.toBeNull();

    vi.useRealTimers();
  });
});

/* ================================================================== */
/*  RenderedContent — Code blocks                                      */
/* ================================================================== */

describe('RenderedContent — code blocks', () => {
  it('renders fenced code blocks as CodeBlock components', () => {
    const content = '```javascript\nconsole.log("hi");\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('javascript')).toBeInTheDocument();
    expect(screen.getByText('console.log("hi");')).toBeInTheDocument();
  });

  it('extracts language from the fence', () => {
    const content = '```typescript\ntype X = number;\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('falls back to empty language (shows "text") when none specified', () => {
    const content = '```\nno lang here\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('no lang here')).toBeInTheDocument();
  });

  it('strips trailing newline from code content', () => {
    const content = '```py\nline1\nline2\n```';
    render(<RenderedContent content={content} />);

    // The trailing newline before ``` should be stripped
    const pre = screen.getByText(/line1/);
    expect(pre.textContent).toBe('line1\nline2');
  });

  it('handles mixed content: prose + code + prose', () => {
    const content = 'Before the code.\n\n```bash\necho hello\n```\n\nAfter the code.';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('Before the code.')).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('echo hello')).toBeInTheDocument();
    expect(screen.getByText('After the code.')).toBeInTheDocument();
  });

  it('handles multiple code blocks', () => {
    const content = '```js\nconst a = 1;\n```\n\nSome text.\n\n```python\nx = 2\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('js')).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('Some text.')).toBeInTheDocument();
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('x = 2')).toBeInTheDocument();
  });
});

/* ================================================================== */
/*  RenderedContent — Headings                                         */
/* ================================================================== */

describe('RenderedContent — headings', () => {
  it('renders a line that is exactly **text** as an h4 heading', () => {
    const content = '**My Heading**';
    render(<RenderedContent content={content} />);

    const heading = screen.getByRole('heading', { level: 4 });
    expect(heading).toHaveTextContent('My Heading');
  });

  it('strips the ** markers from headings', () => {
    const content = '**Section Title**';
    render(<RenderedContent content={content} />);

    const heading = screen.getByRole('heading', { level: 4 });
    expect(heading.textContent).toBe('Section Title');
    expect(heading.textContent).not.toContain('**');
  });

  it('does NOT render **bold** as heading if mixed with other text', () => {
    const content = 'This is **bold** in a sentence';
    render(<RenderedContent content={content} />);

    expect(screen.queryByRole('heading')).toBeNull();
    // Should render as bold inline instead
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });
});

/* ================================================================== */
/*  RenderedContent — Lists                                            */
/* ================================================================== */

describe('RenderedContent — lists', () => {
  it('renders consecutive lines starting with "- " as a bullet list', () => {
    const content = '- Item one\n- Item two\n- Item three';
    render(<RenderedContent content={content} />);

    const list = screen.getByRole('list');
    const items = screen.getAllByRole('listitem');
    expect(list.tagName).toBe('UL');
    expect(items).toHaveLength(3);
  });

  it('list items have bullet character', () => {
    const content = '- First item';
    const { container } = render(<RenderedContent content={content} />);

    // The bullet is rendered as &bull; (•) inside a span
    const bulletSpans = container.querySelectorAll('li span');
    // First span in each li is the bullet
    expect(bulletSpans[0].textContent).toBe('•');
  });

  it('list items have formatted inline content', () => {
    const content = '- Item with `code` and **bold**';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('does not render as list if not all lines start with "- "', () => {
    const content = '- Item one\nNot a list item';
    render(<RenderedContent content={content} />);

    expect(screen.queryByRole('list')).toBeNull();
  });
});

/* ================================================================== */
/*  RenderedContent — Paragraphs                                       */
/* ================================================================== */

describe('RenderedContent — paragraphs', () => {
  it('renders regular text as paragraphs', () => {
    const content = 'Hello world, this is a paragraph.';
    const { container } = render(<RenderedContent content={content} />);

    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe('Hello world, this is a paragraph.');
  });

  it('double newlines split into separate paragraphs', () => {
    const content = 'First paragraph.\n\nSecond paragraph.';
    const { container } = render(<RenderedContent content={content} />);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('First paragraph.');
    expect(paragraphs[1].textContent).toBe('Second paragraph.');
  });

  it('skips empty paragraphs from excessive newlines', () => {
    const content = 'First.\n\n\n\n\nSecond.';
    const { container } = render(<RenderedContent content={content} />);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
  });

  it('empty content renders no children', () => {
    const { container } = render(<RenderedContent content="" />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.children).toHaveLength(0);
  });

  it('whitespace-only paragraphs between real content are skipped', () => {
    // Triple newlines cause an empty paragraph in the middle which should be skipped
    const content = 'First.\n\n\n\nSecond.';
    const { container } = render(<RenderedContent content={content} />);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('First.');
    expect(paragraphs[1].textContent).toBe('Second.');
  });
});

/* ================================================================== */
/*  RenderedContent — Inline formatting                                */
/* ================================================================== */

describe('RenderedContent — inline formatting', () => {
  it('renders `code` as inline code with correct tag', () => {
    const content = 'Use `useState` for state.';
    render(<RenderedContent content={content} />);

    const code = screen.getByText('useState');
    expect(code.tagName).toBe('CODE');
  });

  it('renders **bold** as strong', () => {
    const content = 'This is **important** text.';
    render(<RenderedContent content={content} />);

    const strong = screen.getByText('important');
    expect(strong.tagName).toBe('STRONG');
  });

  it('handles mixed inline formatting in the same line', () => {
    const content = 'Call `func()` for **critical** operations.';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('func()').tagName).toBe('CODE');
    expect(screen.getByText('critical').tagName).toBe('STRONG');
  });

  it('plain text without formatting passes through unchanged', () => {
    const content = 'Just plain text here.';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('Just plain text here.')).toBeInTheDocument();
  });

  it('handles text before and after inline formatting', () => {
    const content = 'Start `middle` end';
    const { container } = render(<RenderedContent content={content} />);

    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    // The paragraph should contain all three text segments
    expect(p!.textContent).toBe('Start middle end');
  });

  it('handles multiple inline codes in one line', () => {
    const content = 'Use `foo` and `bar` together.';
    render(<RenderedContent content={content} />);

    const codeElements = screen.getAllByText(/^(foo|bar)$/);
    expect(codeElements).toHaveLength(2);
    expect(codeElements[0].tagName).toBe('CODE');
    expect(codeElements[1].tagName).toBe('CODE');
  });

  it('handles multiple bold segments in one line', () => {
    const content = 'Both **alpha** and **beta** are important.';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('alpha').tagName).toBe('STRONG');
    expect(screen.getByText('beta').tagName).toBe('STRONG');
  });
});

/* ================================================================== */
/*  RenderedContent — className prop                                   */
/* ================================================================== */

describe('RenderedContent — className prop', () => {
  it('applies custom className to wrapper div', () => {
    const { container } = render(<RenderedContent content="hello" className="my-custom-class" />);

    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('wrapper has content class even without custom className', () => {
    const { container } = render(<RenderedContent content="hello" />);

    // The wrapper div should exist
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});

/* ================================================================== */
/*  RenderedContent — complex / edge-case scenarios                     */
/* ================================================================== */

describe('RenderedContent — complex scenarios', () => {
  it('renders heading followed by list followed by paragraph', () => {
    const content = '**Steps**\n\n- Step one\n- Step two\n\nThat is all.';
    render(<RenderedContent content={content} />);

    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Steps');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText('That is all.')).toBeInTheDocument();
  });

  it('handles prose block with single newlines (not double) as one paragraph', () => {
    const content = 'Line one\nLine two\nLine three';
    const { container } = render(<RenderedContent content={content} />);

    // Single newlines don't split paragraphs — they stay as one paragraph
    // The "isList" check will fail since lines don't start with "- "
    // So it renders as a single paragraph
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
  });

  it('handles code block at the very beginning of content', () => {
    const content = '```go\nfmt.Println("hi")\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('go')).toBeInTheDocument();
    expect(screen.getByText('fmt.Println("hi")')).toBeInTheDocument();
  });

  it('handles code block at the very end of content', () => {
    const content = 'Some intro.\n\n```rust\nfn main() {}\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('Some intro.')).toBeInTheDocument();
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('fn main() {}')).toBeInTheDocument();
  });

  it('handles content with only whitespace between code blocks', () => {
    const content = '```js\na\n```\n\n```js\nb\n```';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('inline formatting inside list items works correctly', () => {
    const content = '- Use `npm install` to install\n- Run **tests** first';
    render(<RenderedContent content={content} />);

    expect(screen.getByText('npm install').tagName).toBe('CODE');
    expect(screen.getByText('tests').tagName).toBe('STRONG');
  });
});

/* ================================================================== */
/*  RenderedContent — Outcome blocks                                   */
/* ================================================================== */

describe('RenderedContent — outcome blocks', () => {
  const outcomeBlock = `---outcome---
verdict: approve
tests_passing: true
scope_adherence: 0.95
summary: Implementation complete with full test coverage
---end---`;

  it('renders an outcome block as a card instead of raw text', () => {
    const { container } = render(<RenderedContent content={outcomeBlock} />);

    // Should not contain the raw markers
    expect(screen.queryByText(/---outcome---/)).toBeNull();
    expect(screen.queryByText(/---end---/)).toBeNull();

    // Should render as a card with the "Outcome" label
    expect(screen.getByText('Outcome')).toBeInTheDocument();
    expect(container.querySelector('[class*="outcomeCard"]')).toBeInTheDocument();
  });

  it('renders the verdict as a badge', () => {
    render(<RenderedContent content={outcomeBlock} />);

    expect(screen.getByText('approve')).toBeInTheDocument();
  });

  it('sets data-verdict="approve" on the badge for green coloring', () => {
    const { container } = render(<RenderedContent content={outcomeBlock} />);

    const badge = container.querySelector('[class*="outcomeBadge"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute('data-verdict', 'approve');
  });

  it('sets data-verdict="retry" for retry verdict', () => {
    const content = '---outcome---\nverdict: retry\nsummary: needs more work\n---end---';
    const { container } = render(<RenderedContent content={content} />);

    const badge = container.querySelector('[class*="outcomeBadge"]');
    expect(badge).toHaveAttribute('data-verdict', 'retry');
  });

  it('sets data-verdict="escalate" for escalate verdict', () => {
    const content = '---outcome---\nverdict: escalate\nsummary: requires escalation\n---end---';
    const { container } = render(<RenderedContent content={content} />);

    const badge = container.querySelector('[class*="outcomeBadge"]');
    expect(badge).toHaveAttribute('data-verdict', 'escalate');
  });

  it('sets data-verdict="unknown" for unrecognized verdicts', () => {
    const content = '---outcome---\nverdict: custom_status\nsummary: unusual\n---end---';
    const { container } = render(<RenderedContent content={content} />);

    const badge = container.querySelector('[class*="outcomeBadge"]');
    expect(badge).toHaveAttribute('data-verdict', 'unknown');
  });

  it('renders non-verdict fields as key-value pairs', () => {
    render(<RenderedContent content={outcomeBlock} />);

    expect(screen.getByText('tests_passing')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('scope_adherence')).toBeInTheDocument();
    expect(screen.getByText('0.95')).toBeInTheDocument();
    expect(screen.getByText('summary')).toBeInTheDocument();
    expect(screen.getByText('Implementation complete with full test coverage')).toBeInTheDocument();
  });

  it('does not render verdict as a field row (only as badge)', () => {
    render(<RenderedContent content={outcomeBlock} />);

    // 'approve' should only appear once (as the badge), not as a field value
    const approveElements = screen.getAllByText('approve');
    expect(approveElements).toHaveLength(1);
  });

  it('shows "Show raw" button initially', () => {
    render(<RenderedContent content={outcomeBlock} />);

    expect(screen.getByText('Show raw')).toBeInTheDocument();
    expect(screen.queryByText('Hide raw')).toBeNull();
  });

  it('shows raw YAML when "Show raw" is clicked', () => {
    render(<RenderedContent content={outcomeBlock} />);

    fireEvent.click(screen.getByText('Show raw'));

    expect(screen.getByText('Hide raw')).toBeInTheDocument();
    // Raw yaml content should now be visible
    const pre = screen.getByText(/verdict: approve/);
    expect(pre.tagName).toBe('PRE');
  });

  it('hides raw YAML when "Hide raw" is clicked', () => {
    render(<RenderedContent content={outcomeBlock} />);

    fireEvent.click(screen.getByText('Show raw'));
    expect(screen.getByText('Hide raw')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Hide raw'));
    expect(screen.getByText('Show raw')).toBeInTheDocument();
    expect(screen.queryByText(/verdict: approve/)).toBeNull();
  });

  it('strips outcome markers from surrounding message text', () => {
    const content = `Before the outcome.\n\n${outcomeBlock}\n\nAfter the outcome.`;
    render(<RenderedContent content={content} />);

    expect(screen.getByText('Before the outcome.')).toBeInTheDocument();
    expect(screen.getByText('After the outcome.')).toBeInTheDocument();
    expect(screen.getByText('Outcome')).toBeInTheDocument();
  });

  it('handles outcome block with no verdict gracefully', () => {
    const content = '---outcome---\nsummary: analysis complete\n---end---';
    const { container } = render(<RenderedContent content={content} />);

    expect(screen.getByText('Outcome')).toBeInTheDocument();
    // No badge when verdict is absent
    expect(container.querySelector('[class*="outcomeBadge"]')).toBeNull();
    expect(screen.getByText('analysis complete')).toBeInTheDocument();
  });

  it('renders multiple outcome blocks', () => {
    const block2 = '---outcome---\nverdict: fail\nsummary: second check\n---end---';
    const content = `${outcomeBlock}\n\n${block2}`;
    const { container } = render(<RenderedContent content={content} />);

    const cards = container.querySelectorAll('[class*="outcomeCard"]');
    expect(cards).toHaveLength(2);
  });
});
