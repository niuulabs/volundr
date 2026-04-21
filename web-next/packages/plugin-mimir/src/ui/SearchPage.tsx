import { Chip, StateDot } from '@niuulabs/ui';
import { useSearch } from '../application/useSearch';
import type { SearchMode } from '../ports';
import './mimir-views.css';

const MODES: SearchMode[] = ['fts', 'semantic', 'hybrid'];

const MODE_LABELS: Record<SearchMode, string> = {
  fts: 'FTS',
  semantic: 'SEMANTIC',
  hybrid: 'HYBRID',
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
// SearchPage — matches web2 mimir/design/views.jsx SearchView layout
// ---------------------------------------------------------------------------

export function SearchPage() {
  const { query, mode, setQuery, setMode, results, isLoading, isError, error } = useSearch();

  return (
    <div className="niuu-p-5 niuu-flex niuu-flex-col niuu-gap-4 niuu-h-full">
      {/* Search input + mode buttons on same row */}
      <div className="niuu-flex niuu-items-center niuu-gap-3">
        <input
          className="niuu-flex-1 niuu-px-4 niuu-py-2 niuu-bg-bg-secondary niuu-border niuu-border-border niuu-rounded-sm niuu-text-text-primary niuu-font-mono niuu-text-sm niuu-outline-none focus:niuu-border-brand niuu-box-border"
          type="search"
          placeholder="Search pages across all mounts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search query"
        />

        <div className="niuu-flex niuu-items-center niuu-gap-1" role="group" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={[
                'niuu-px-3 niuu-py-1 niuu-rounded-sm niuu-font-mono niuu-text-[11px] niuu-tracking-wider niuu-cursor-pointer niuu-border niuu-transition-colors',
                m === mode
                  ? 'niuu-bg-brand niuu-border-brand niuu-text-bg-primary niuu-font-bold'
                  : 'niuu-bg-transparent niuu-border-transparent niuu-text-text-muted hover:niuu-text-text-secondary',
              ].join(' ')}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
              data-mode={m}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
          {results.length > 0 && (
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted niuu-ml-2">
              {results.length} results
            </span>
          )}
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

      {/* Results list — borderless rows with bottom separator */}
      {results.length > 0 && (
        <div className="niuu-flex niuu-flex-col niuu-overflow-y-auto" aria-label="Search results">
          {results.map((result) => (
            <div
              key={result.path}
              className="niuu-py-4 niuu-border-b niuu-border-border-subtle"
              data-testid="search-result"
            >
              {/* Title row + chips + score */}
              <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-mb-1">
                <span className="niuu-font-semibold niuu-text-sm niuu-text-text-primary">
                  {highlightText(result.title, query)}
                </span>
                <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
                  {result.path}
                </span>
                <div className="niuu-ml-auto niuu-flex niuu-items-center niuu-gap-2 niuu-shrink-0">
                  {result.score !== undefined && (
                    <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
                      score {result.score.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Summary */}
              <p className="niuu-text-sm niuu-text-text-secondary niuu-m-0 niuu-mb-2">
                {highlightText(result.summary, query)}
              </p>

              {/* Chips row */}
              <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-wrap">
                <span className="niuu-font-mono niuu-text-[10px] niuu-tracking-wider niuu-uppercase niuu-px-2 niuu-py-[1px] niuu-rounded-sm niuu-border niuu-border-brand-300 niuu-text-brand-300">
                  TYPE {result.type?.toUpperCase() ?? result.category?.toUpperCase()}
                </span>
                <span className="niuu-font-mono niuu-text-[10px] niuu-tracking-wider niuu-uppercase niuu-px-2 niuu-py-[1px] niuu-rounded-sm niuu-bg-text-primary niuu-text-bg-primary niuu-font-bold">
                  CONF {result.confidence?.toUpperCase()}
                </span>
                {result.mounts?.map((mount) => (
                  <span
                    key={mount}
                    className="niuu-font-mono niuu-text-[10px] niuu-tracking-wider niuu-uppercase niuu-px-2 niuu-py-[1px] niuu-rounded-sm niuu-border niuu-border-border-subtle niuu-text-text-muted"
                  >
                    {mount}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
