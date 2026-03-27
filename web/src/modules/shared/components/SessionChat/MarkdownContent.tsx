import { useCallback, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, WrapText } from 'lucide-react';
import { cn } from '@/utils';
import styles from './MarkdownContent.module.css';

const COLLAPSE_LINE_THRESHOLD = 25;

/* ------------------------------------------------------------------ */
/*  Code block with copy button                                        */
/* ------------------------------------------------------------------ */

interface CodeBlockRendererProps {
  language: string;
  code: string;
}

function CodeBlockRenderer({ language, code }: CodeBlockRendererProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const lines = code.split('\n');
  const lineCount = lines.length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;
  const shouldCollapse = isLong && collapsed;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const displayCode = shouldCollapse ? lines.slice(0, COLLAPSE_LINE_THRESHOLD).join('\n') : code;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language || 'text'}</span>
        <div className={styles.codeHeaderActions}>
          <button
            type="button"
            className={styles.codeHeaderBtn}
            onClick={() => setShowLineNumbers(prev => !prev)}
            title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
            data-testid="toggle-line-numbers"
          >
            <span className={styles.codeHeaderBtnLabel}>{showLineNumbers ? '#' : '¶'}</span>
          </button>
          <button
            type="button"
            className={styles.codeHeaderBtn}
            onClick={() => setWordWrap(prev => !prev)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            data-active={wordWrap}
            data-testid="toggle-word-wrap"
          >
            <WrapText className={styles.copyIcon} />
          </button>
          <button type="button" className={styles.copyBtn} onClick={handleCopy}>
            {copied ? <Check className={styles.copyIcon} /> : <Copy className={styles.copyIcon} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div
        className={cn(styles.codeContent, shouldCollapse && styles.codeCollapsed)}
        data-wrap={wordWrap}
      >
        <pre>
          <code className={showLineNumbers ? styles.codeContentGrid : undefined}>
            {showLineNumbers && (
              <span className={styles.lineNumbers} aria-hidden="true">
                {(shouldCollapse ? lines.slice(0, COLLAPSE_LINE_THRESHOLD) : lines).map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </span>
            )}
            <span>{displayCode}</span>
          </code>
        </pre>
        {shouldCollapse && <div className={styles.codeFade} />}
      </div>
      {shouldCollapse && (
        <button type="button" className={styles.showAllBtn} onClick={() => setCollapsed(false)}>
          Show all {lineCount} lines
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MarkdownContent                                                     */
/* ------------------------------------------------------------------ */

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function MarkdownContent({ content, isStreaming, className }: MarkdownContentProps) {
  return (
    <div className={cn(styles.content, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
          h1: ({ children }) => <h1 className={styles.h1}>{children}</h1>,
          h2: ({ children }) => <h2 className={styles.h2}>{children}</h2>,
          h3: ({ children }) => <h3 className={styles.h3}>{children}</h3>,
          code: ({
            className: codeClassName,
            children,
            ...rest
          }: ComponentPropsWithoutRef<'code'> & { className?: string }) => {
            const match = /language-(\w+)/.exec(codeClassName ?? '');
            const codeString = String(children).replace(/\n$/, '');

            // Block code (inside <pre>) has a language class
            if (match) {
              return <CodeBlockRenderer language={match[1]} code={codeString} />;
            }

            // Check if parent is a <pre> (fenced code block without language)
            const node = (rest as Record<string, unknown>).node as
              | { position?: { start?: { line?: number }; end?: { line?: number } } }
              | undefined;
            const isBlock = node?.position?.start?.line !== node?.position?.end?.line;
            if (codeClassName || isBlock) {
              return <CodeBlockRenderer language="" code={codeString} />;
            }

            // Inline code
            return <code className={styles.inlineCode}>{children}</code>;
          },
          pre: ({ children }) => {
            // If the child is already a CodeBlockRenderer, render it directly
            return <>{children}</>;
          },
          ul: ({ children }) => <ul className={styles.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.ol}>{children}</ol>,
          li: ({ children }) => <li className={styles.li}>{children}</li>,
          table: ({ children }) => (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className={styles.thead}>{children}</thead>,
          th: ({ children }) => <th className={styles.th}>{children}</th>,
          td: ({ children }) => <td className={styles.td}>{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className={styles.blockquote}>{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className={styles.strong}>{children}</strong>,
          em: ({ children }) => <em className={styles.em}>{children}</em>,
          hr: () => <hr className={styles.hr} />,
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && <span className={styles.streamingCursor} />}
    </div>
  );
}
