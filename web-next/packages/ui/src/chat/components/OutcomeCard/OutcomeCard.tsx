import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, RotateCcw, ArrowUpCircle } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { MeshVerdict } from '../../types';
import './OutcomeCard.css';

const OUTCOME_BLOCK_RE =
  /```outcome\n([\s\S]*?)```|<outcome>([\s\S]*?)<\/outcome>/;

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
  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) fields[key] = value;
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
    <div className={cn('niuu-chat-outcome', verdict && `niuu-chat-outcome--${verdict}`)} data-testid="outcome-card">
      <div className="niuu-chat-outcome-header">
        <Icon className="niuu-chat-outcome-icon" />
        <span className="niuu-chat-outcome-label">Outcome</span>
        {verdict && <span className={`niuu-chat-outcome-badge niuu-chat-outcome-badge--${verdict}`}>{verdict}</span>}
      </div>
      {summary && <p className="niuu-chat-outcome-summary">{summary}</p>}
      <div className="niuu-chat-outcome-fields">
        {Object.entries(fields)
          .filter(([k]) => k !== 'verdict' && k !== 'status' && k !== 'summary' && k !== 'result')
          .map(([k, v]) => (
            <div key={k} className="niuu-chat-outcome-field">
              <span className="niuu-chat-outcome-field-key">{k}</span>
              <span className="niuu-chat-outcome-field-value">{v}</span>
            </div>
          ))}
      </div>
      <button
        type="button"
        className="niuu-chat-outcome-toggle"
        onClick={() => setShowRaw(prev => !prev)}
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
export function extractOutcomeBlock(text: string): { before: string; raw: string; after: string } | null {
  const match = OUTCOME_BLOCK_RE.exec(text);
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? '').trim();
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return { before, raw, after };
}
