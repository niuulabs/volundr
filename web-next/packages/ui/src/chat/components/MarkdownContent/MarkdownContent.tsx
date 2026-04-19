import { useState } from 'react';
import { Copy, Check, ChevronRight, ChevronDown, WrapText } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { OutcomeCard, extractOutcomeBlock } from '../OutcomeCard';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import './MarkdownContent.css';

const CURSOR_CHAR = '▊';

interface CodeBlockProps {
  language?: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, handleCopy] = useCopyFeedback(code);
  const [collapsed, setCollapsed] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);

  return (
    <div className="niuu-chat-md-codeblock" data-testid="code-block">
      <div className="niuu-chat-md-codeblock-header">
        {language && <span className="niuu-chat-md-codeblock-lang">{language}</span>}
        <div className="niuu-chat-md-codeblock-actions">
          <button
            type="button"
            className="niuu-chat-md-codeblock-btn"
            onClick={() => setWordWrap((prev) => !prev)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            aria-pressed={wordWrap}
          >
            <WrapText className="niuu-chat-md-codeblock-btn-icon" />
          </button>
          <button
            type="button"
            className="niuu-chat-md-codeblock-btn"
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? (
              <ChevronRight className="niuu-chat-md-codeblock-btn-icon" />
            ) : (
              <ChevronDown className="niuu-chat-md-codeblock-btn-icon" />
            )}
          </button>
          <button
            type="button"
            className="niuu-chat-md-codeblock-btn"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? (
              <Check className="niuu-chat-md-codeblock-btn-icon" />
            ) : (
              <Copy className="niuu-chat-md-codeblock-btn-icon" />
            )}
          </button>
        </div>
      </div>
      {!collapsed && (
        <pre
          className={cn(
            'niuu-chat-md-codeblock-pre',
            wordWrap && 'niuu-chat-md-codeblock-pre--wrap',
          )}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * Parse text into segments: plain text and fenced code blocks.
 */
type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'outcome'; raw: string };

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const remaining = text;
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRe.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = remaining.slice(lastIndex, match.index);
      const outcome = extractOutcomeBlock(textChunk);
      if (outcome) {
        if (outcome.before.trim()) segments.push({ type: 'text', content: outcome.before });
        segments.push({ type: 'outcome', raw: outcome.raw });
        if (outcome.after.trim()) segments.push({ type: 'text', content: outcome.after });
      } else {
        segments.push({ type: 'text', content: textChunk });
      }
    }
    const lang = match[1] === 'outcome' ? 'outcome' : (match[1] ?? '');
    if (lang === 'outcome') {
      segments.push({ type: 'outcome', raw: (match[2] ?? '').trim() });
    } else {
      segments.push({ type: 'code', language: lang, content: match[2] ?? '' });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < remaining.length) {
    const textChunk = remaining.slice(lastIndex);
    const outcome = extractOutcomeBlock(textChunk);
    if (outcome) {
      if (outcome.before.trim()) segments.push({ type: 'text', content: outcome.before });
      segments.push({ type: 'outcome', raw: outcome.raw });
      if (outcome.after.trim()) segments.push({ type: 'text', content: outcome.after });
    } else {
      segments.push({ type: 'text', content: textChunk });
    }
  }

  return segments;
}

/**
 * Render a text segment with basic markdown-like formatting.
 * Handles: headings, bold, inline code, lists, blockquotes, links.
 */
function TextSegment({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = (headingMatch[1] ?? '').length as 1 | 2 | 3 | 4 | 5 | 6;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      elements.push(
        <Tag key={i} className={`niuu-chat-md-h${level}`}>
          {headingMatch[2] ?? ''}
        </Tag>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="niuu-chat-md-blockquote">
          {line.slice(2)}
        </blockquote>,
      );
      i++;
      continue;
    }

    // Unordered list item
    if (/^[-*+]\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const ln = lines[i];
        if (!ln || !/^[-*+]\s/.test(ln)) break;
        listItems.push(ln.replace(/^[-*+]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="niuu-chat-md-ul">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list item
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const ln = lines[i];
        if (!ln || !/^\d+\.\s/.test(ln)) break;
        listItems.push(ln.replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="niuu-chat-md-ol">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="niuu-chat-md-p">
        {renderInline(line)}
        {isStreaming && i === lines.length - 1 && (
          <span className="niuu-chat-md-cursor">{CURSOR_CHAR}</span>
        )}
      </p>,
    );
    i++;
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Handle bold (**text**), inline code (`code`), and links [text](url)
  const parts: React.ReactNode[] = [];
  const inlineRe = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={key++} className="niuu-chat-md-inline-code">
          {match[3]}
        </code>,
      );
    } else if (match[4] && match[5]) {
      parts.push(
        <a
          key={key++}
          href={match[5]}
          className="niuu-chat-md-link"
          target="_blank"
          rel="noreferrer"
        >
          {match[4]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
}

export function MarkdownContent({ content, isStreaming = false }: MarkdownContentProps) {
  const segments = parseSegments(content);

  return (
    <div className="niuu-chat-md" data-testid="markdown-content">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return <CodeBlock key={i} language={seg.language} code={seg.content} />;
        }
        if (seg.type === 'outcome') {
          return <OutcomeCard key={i} raw={seg.raw} />;
        }
        return (
          <TextSegment
            key={i}
            content={seg.content}
            isStreaming={isStreaming && i === segments.length - 1}
          />
        );
      })}
    </div>
  );
}
