import { Chip, StateDot } from '@niuulabs/ui';
import { useSearch } from '../application/useSearch';
import type { SearchMode } from '../ports';
import { MountChip } from './components/MountChip';
import './mimir-views.css';

const MODES: SearchMode[] = ['fts', 'semantic', 'hybrid'];

const MODE_LABELS: Record<SearchMode, string> = {
  fts: 'Full-text',
  semantic: 'Semantic',
  hybrid: 'Hybrid',
};

// ---------------------------------------------------------------------------
// Highlight utility
// ---------------------------------------------------------------------------

function highlightText(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return text;

  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length <= 1) return text;

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="mm-highlight">
            {part}
          </mark>
        ) : (
          part || null
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SearchPage
// ---------------------------------------------------------------------------

export function SearchPage() {
  const { query, mode, setQuery, setMode, results, isLoading, isError, error } = useSearch();

  return (
    <div className="niuu-p-6 niuu-max-w-4xl">
      <h2 className="niuu-m-0 niuu-mb-5 niuu-text-2xl niuu-font-semibold niuu-text-text-primary">
        Search
      </h2>

      <div className="niuu-flex niuu-flex-col niuu-gap-3 niuu-mb-6">
        <input
          className="niuu-w-full niuu-px-3 niuu-py-2 niuu-bg-bg-secondary niuu-border niuu-border-border niuu-rounded-md niuu-text-text-primary niuu-font-sans niuu-text-sm niuu-outline-none focus:niuu-border-brand niuu-box-border"
          type="search"
          placeholder="Search pages across all mounts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search query"
        />

        <div className="niuu-flex niuu-gap-2" role="group" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={[
                'niuu-px-3 niuu-py-1 niuu-rounded-sm niuu-font-sans niuu-text-xs niuu-cursor-pointer niuu-border',
                m === mode
                  ? 'niuu-bg-brand niuu-border-brand niuu-text-bg-primary niuu-font-medium'
                  : 'niuu-bg-bg-secondary niuu-border-border-subtle niuu-text-text-secondary',
              ].join(' ')}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
              data-mode={m}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <StateDot state="processing" pulse />
          <span className="niuu-text-sm niuu-text-text-secondary">searching…</span>
        </div>
      )}

      {isError && (
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <StateDot state="failed" />
          <span className="niuu-text-sm niuu-text-text-secondary">
            {error instanceof Error ? error.message : 'search failed'}
          </span>
        </div>
      )}

      {!isLoading && query.trim().length > 0 && results.length === 0 && !isError && (
        <p className="niuu-text-sm niuu-text-text-muted">
          No results found for &ldquo;{query}&rdquo;
        </p>
      )}

      {results.length > 0 && (
        <ul
          className="niuu-list-none niuu-p-0 niuu-m-0 niuu-grid niuu-gap-3"
          aria-label="Search results"
        >
          {results.map((result) => (
            <li
              key={result.path}
              className="niuu-p-4 niuu-border niuu-border-border-subtle niuu-rounded-md niuu-bg-bg-secondary"
              data-testid="search-result"
            >
              <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-mb-2 niuu-flex-wrap">
                <span
                  className="niuu-flex-1 niuu-font-medium niuu-text-sm niuu-text-text-primary"
                  data-testid="result-title"
                >
                  {highlightText(result.title, query)}
                </span>
                <Chip tone="muted">{result.category}</Chip>
                <Chip tone={result.confidence === 'high' ? 'default' : 'muted'}>
                  {result.confidence}
                </Chip>
                {result.mounts?.map((mount) => (
                  <MountChip key={mount} name={mount} />
                ))}
                {result.score !== undefined && (
                  <span
                    className="niuu-font-mono niuu-text-xs niuu-text-text-muted niuu-ml-auto niuu-shrink-0"
                    data-testid="result-score"
                  >
                    score {result.score.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="niuu-text-sm niuu-text-text-secondary niuu-m-0 niuu-mb-2">
                {highlightText(result.summary, query)}
              </p>
              <span
                className="niuu-text-xs niuu-text-text-muted niuu-font-mono"
                data-testid="result-path"
              >
                {result.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
