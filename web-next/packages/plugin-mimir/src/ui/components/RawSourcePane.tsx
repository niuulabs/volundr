/**
 * RawSourcePane — right-side pane in split view.
 *
 * Shows the raw source records that back the current page. Each source card
 * renders its content with [[wikilink]] tokens highlighted inline using the
 * WikilinkPill style, and zone boundaries separated by subtle horizontal rules.
 */

import { Fragment } from 'react';

interface RawSource {
  id: string;
  title: string;
  originType: string;
  content: string;
}

interface RawSourcePaneProps {
  sources: RawSource[];
  /** Called when user clicks a resolved wikilink inside source content. */
  onNavigate?: (path: string) => void;
}

/** Split a raw text string into literal parts and [[wikilink]] tokens. */
function splitWikilinks(text: string): Array<{ kind: 'text'; value: string } | { kind: 'link'; slug: string }> {
  const parts: Array<{ kind: 'text'; value: string } | { kind: 'link'; slug: string }> = [];
  const re = /(\[\[[^\]]+]])/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) {
      parts.push({ kind: 'text', value: text.slice(last, match.index) });
    }
    const slug = match[0].slice(2, -2);
    parts.push({ kind: 'link', slug });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', value: text.slice(last) });
  }
  return parts;
}

function SourceContent({ content, onNavigate }: { content: string; onNavigate?: (path: string) => void }) {
  const parts = splitWikilinks(content);
  return (
    <p className="niuu-m-0 niuu-text-xs niuu-text-text-secondary niuu-font-mono niuu-whitespace-pre-wrap niuu-break-words">
      {parts.map((part, i) => {
        if (part.kind === 'link') {
          return (
            <button
              key={i}
              type="button"
              className="mm-wikilink mm-wikilink--resolved"
              onClick={() => onNavigate?.(part.slug)}
              aria-label={`navigate to ${part.slug}`}
            >
              [[{part.slug}]]
            </button>
          );
        }
        return <Fragment key={i}>{part.value}</Fragment>;
      })}
    </p>
  );
}

export function RawSourcePane({ sources, onNavigate }: RawSourcePaneProps) {
  return (
    <div className="niuu-p-4 niuu-flex niuu-flex-col niuu-gap-3" aria-label="raw sources">
      <div className="niuu-text-xs niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-mb-1">
        Raw sources backing this page
      </div>

      {sources.length === 0 && (
        <p className="niuu-text-xs niuu-text-text-muted niuu-italic niuu-m-0">
          No sources attributed yet.
        </p>
      )}

      {sources.map((source) => (
        <div
          key={source.id}
          className="niuu-bg-bg-primary niuu-border niuu-border-border-subtle niuu-rounded-md niuu-p-3 niuu-flex niuu-flex-col niuu-gap-2"
          aria-label={`source ${source.id}`}
        >
          <div className="niuu-flex niuu-items-baseline niuu-gap-2">
            <span className="niuu-font-mono niuu-text-xs niuu-text-brand-300">{source.id}</span>
            <span className="niuu-text-xs niuu-text-text-muted">·</span>
            <span className="niuu-text-xs niuu-text-text-primary niuu-flex-1 niuu-truncate">
              {source.title}
            </span>
            <span className="niuu-text-xs niuu-text-text-muted niuu-font-mono">
              {source.originType}
            </span>
          </div>
          {source.content && (
            <SourceContent content={source.content} onNavigate={onNavigate} />
          )}
        </div>
      ))}
    </div>
  );
}
