import { Chip, StateDot } from '@niuulabs/ui';
import { useSearch } from '../application/useSearch';
import type { SearchMode } from '../ports';
import './SearchPage.css';

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
          <mark key={i} className="search-page__highlight">
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
    <div className="search-page">
      <h2 className="search-page__title">Search</h2>

      <div className="search-page__controls">
        <input
          className="search-page__input"
          type="search"
          placeholder="Search pages across all mounts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search query"
        />

        <div className="search-page__modes" role="group" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={[
                'search-page__mode-btn',
                m === mode ? 'search-page__mode-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
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
        <div className="search-page__status">
          <StateDot state="processing" pulse />
          <span>searching…</span>
        </div>
      )}

      {isError && (
        <div className="search-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'search failed'}</span>
        </div>
      )}

      {!isLoading && query.trim().length > 0 && results.length === 0 && !isError && (
        <p className="search-page__empty">No results found for &ldquo;{query}&rdquo;</p>
      )}

      {results.length > 0 && (
        <ul className="search-page__results" aria-label="Search results">
          {results.map((result) => (
            <li key={result.path} className="search-page__result" data-testid="search-result">
              <div className="search-page__result-header">
                <span className="search-page__result-title">
                  {highlightText(result.title, query)}
                </span>
                <Chip tone="muted">{result.category}</Chip>
                <Chip tone={result.confidence === 'high' ? 'default' : 'muted'}>
                  {result.confidence}
                </Chip>
              </div>
              <p className="search-page__result-summary">{highlightText(result.summary, query)}</p>
              <span className="search-page__result-path">{result.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
