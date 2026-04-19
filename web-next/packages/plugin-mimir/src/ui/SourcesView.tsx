/**
 * SourcesView — raw ingest records filtered by origin type.
 *
 * Shows all source records ingested into Mímir, filterable by origin:
 * web / rss / arxiv / file / mail / chat.
 *
 * Each row shows: origin badge, title, URL/path, ingest agent + date,
 * and the pages it was compiled into.
 */

import { useState } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useMimirSources } from './useMimirSources';
import type { OriginType } from '../domain/source';
import './mimir-views.css';

const ORIGINS: Array<{ id: OriginType | 'all'; label: string }> = [
  { id: 'all', label: 'all' },
  { id: 'web', label: 'web' },
  { id: 'rss', label: 'rss' },
  { id: 'arxiv', label: 'arxiv' },
  { id: 'file', label: 'file' },
  { id: 'mail', label: 'mail' },
  { id: 'chat', label: 'chat' },
];

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function SourcesView() {
  const [activeOrigin, setActiveOrigin] = useState<OriginType | 'all'>('all');

  const { data: sources, isLoading, isError, error } = useMimirSources(
    activeOrigin !== 'all' ? { originType: activeOrigin } : undefined,
  );

  return (
    <div className="mm-sources">
      {/* ── Origin filter tabs ─────────────────────────────────── */}
      <div className="mm-origin-tabs" role="tablist" aria-label="filter by origin">
        {ORIGINS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeOrigin === id}
            className={`mm-origin-chip${activeOrigin === id ? ' mm-origin-chip--active' : ''}`}
            onClick={() => setActiveOrigin(id as OriginType | 'all')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Status ─────────────────────────────────────────────── */}
      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            loading sources…
          </span>
        </div>
      )}

      {isError && (
        <div style={{ color: 'var(--color-accent-red)', fontSize: 'var(--text-sm)' }}>
          {error instanceof Error ? error.message : 'failed to load sources'}
        </div>
      )}

      {/* ── Source table ───────────────────────────────────────── */}
      {sources && (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            {sources.length} source{sources.length !== 1 ? 's' : ''}
            {activeOrigin !== 'all' ? ` · origin: ${activeOrigin}` : ''}
          </p>

          <div
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
            aria-label="sources table"
            role="table"
          >
            {/* header */}
            <div
              className="mm-source-row"
              style={{ background: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border)' }}
              role="row"
            >
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }} role="columnheader">ID</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }} role="columnheader">Title</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }} role="columnheader">Origin / content</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }} role="columnheader">Compiled into</span>
            </div>

            {sources.length === 0 && (
              <div
                style={{
                  padding: 'var(--space-8)',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-sm)',
                  fontStyle: 'italic',
                }}
              >
                No sources for this origin filter.
              </div>
            )}

            {sources.map((source) => (
              <div key={source.id} className="mm-source-row" role="row">
                {/* ID + origin badge */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <span className="mm-source-id">{source.id.slice(0, 10)}</span>
                  <span
                    className={`mm-origin-badge mm-origin-badge--${source.originType}`}
                    aria-label={`origin: ${source.originType}`}
                  >
                    {source.originType}
                  </span>
                </div>

                {/* Title */}
                <div>
                  <span className="mm-source-title">{source.title}</span>
                  <div
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      marginTop: 2,
                    }}
                  >
                    ingested {formatDate(source.ingestedAt)} · {source.ingestAgent}
                  </div>
                </div>

                {/* URL or path */}
                <div>
                  {source.originUrl ? (
                    <span className="mm-source-url" title={source.originUrl}>
                      {source.originUrl}
                    </span>
                  ) : source.originPath ? (
                    <span className="mm-source-url mm-source-url--path">{source.originPath}</span>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 'var(--text-xs)' }}>—</span>
                  )}
                </div>

                {/* Compiled into */}
                <div className="mm-source-compiled">
                  {source.compiledInto.length > 0 ? (
                    source.compiledInto.map((path) => (
                      <span
                        key={path}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--color-accent-cyan)',
                          background: 'color-mix(in srgb, var(--color-accent-cyan) 10%, transparent)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '1px 4px',
                        }}
                      >
                        {path}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 'var(--text-xs)' }}>
                      not compiled yet
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
