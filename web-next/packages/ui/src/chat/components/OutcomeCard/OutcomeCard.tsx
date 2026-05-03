import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, RotateCcw, ArrowUpCircle } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { MeshVerdict } from '../../types';
import { MarkdownContent } from '../MarkdownContent';
import './OutcomeCard.css';

const VERDICT_ICONS: Record<MeshVerdict, typeof CheckCircle> = {
  approve: CheckCircle,
  pass: CheckCircle,
  retry: RotateCcw,
  escalate: ArrowUpCircle,
  fail: XCircle,
  needs_changes: AlertTriangle,
  needs_review: AlertTriangle,
};

function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = raw.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const colon = line.indexOf(':');
    if (colon === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) {
      i++;
      continue;
    }

    if (value === '|' || value === '>') {
      const preserveNewlines = value === '|';
      const blockLines: string[] = [];
      let blockIndent: number | null = null;
      i++;

      while (i < lines.length) {
        const nextLine = lines[i] ?? '';
        const trimmed = nextLine.trim();

        if (trimmed.length === 0) {
          blockLines.push('');
          i++;
          continue;
        }

        const indent = nextLine.length - nextLine.trimStart().length;
        if (blockIndent == null) {
          blockIndent = indent;
        }

        if (indent < blockIndent) {
          break;
        }

        blockLines.push(nextLine.slice(blockIndent));
        i++;
      }

      fields[key] = preserveNewlines
        ? blockLines.join('\n').trim()
        : blockLines.join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }

    fields[key] = value;
    i++;
  }
  return fields;
}

interface OutcomeCardProps {
  raw: string;
}

export function OutcomeCard({ raw }: OutcomeCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const fields = parseFields(raw);
  const verdict = (fields.verdict ?? fields.status ?? '') as MeshVerdict | '';
  const summary = fields.summary ?? fields.result ?? '';
  const Icon = verdict && VERDICT_ICONS[verdict] ? VERDICT_ICONS[verdict] : CheckCircle;

  return (
    <div
      className={cn('niuu-chat-outcome', verdict && `niuu-chat-outcome--${verdict}`)}
      data-testid="outcome-card"
    >
      <div className="niuu-chat-outcome-header">
        <Icon className="niuu-chat-outcome-icon" />
        <span className="niuu-chat-outcome-label">Outcome</span>
        {verdict && (
          <span className={`niuu-chat-outcome-badge niuu-chat-outcome-badge--${verdict}`}>
            {verdict}
          </span>
        )}
      </div>
      {summary && (
        <div className="niuu-chat-outcome-summary">
          <MarkdownContent content={summary} />
        </div>
      )}
      <div className="niuu-chat-outcome-fields">
        {Object.entries(fields)
          .filter(([k]) => k !== 'verdict' && k !== 'status' && k !== 'summary' && k !== 'result')
          .map(([k, v]) => (
            <div key={k} className="niuu-chat-outcome-field">
              <span className="niuu-chat-outcome-field-key">{k}</span>
              <div className="niuu-chat-outcome-field-value">
                <MarkdownContent content={v} />
              </div>
            </div>
          ))}
      </div>
      <button
        type="button"
        className="niuu-chat-outcome-toggle"
        onClick={() => setShowRaw((prev) => !prev)}
      >
        {showRaw ? 'Hide raw' : 'Show raw'}
      </button>
      {showRaw && <pre className="niuu-chat-outcome-raw">{raw}</pre>}
    </div>
  );
}

/**
 * Detect if text contains an outcome block and extract the raw content.
 */
export function extractOutcomeBlock(
  text: string,
): { before: string; raw: string; after: string } | null {
  const fenced = extractFencedOutcomeBlock(text);
  const tagged = extractTaggedOutcomeBlock(text);
  const dashed = extractDashedOutcomeBlock(text);

  const candidates = [fenced, tagged, dashed].filter(
    (candidate): candidate is { before: string; raw: string; after: string } => candidate !== null,
  );

  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) =>
    candidate.before.length <= best.before.length ? candidate : best,
  );
}

function extractFencedOutcomeBlock(
  text: string,
): { before: string; raw: string; after: string } | null {
  const marker = '```outcome';
  const start = text.indexOf(marker);
  if (start === -1) return null;

  let contentStart = start + marker.length;
  if (text[contentStart] === '\n') {
    contentStart += 1;
  }

  const end = text.indexOf('```', contentStart);
  if (end === -1) return null;

  return {
    before: text.slice(0, start),
    raw: text.slice(contentStart, end).trim(),
    after: text.slice(end + 3),
  };
}

function extractTaggedOutcomeBlock(
  text: string,
): { before: string; raw: string; after: string } | null {
  const openTag = '<outcome>';
  const closeTag = '</outcome>';
  const start = text.indexOf(openTag);
  if (start === -1) return null;

  const contentStart = start + openTag.length;
  const end = text.indexOf(closeTag, contentStart);
  if (end === -1) return null;

  return {
    before: text.slice(0, start),
    raw: text.slice(contentStart, end).trim(),
    after: text.slice(end + closeTag.length),
  };
}

function extractDashedOutcomeBlock(
  text: string,
): { before: string; raw: string; after: string } | null {
  const match = /---outcome---\s*([\s\S]*?)\s*(?:---end---|---)(?=\s|$)/i.exec(text);
  if (!match || match.index == null) return null;

  const fullMatch = match[0];
  const raw = match[1] ?? '';
  const start = match.index;
  const end = start + fullMatch.length;

  return {
    before: text.slice(0, start),
    raw: raw.trim(),
    after: text.slice(end),
  };
}
