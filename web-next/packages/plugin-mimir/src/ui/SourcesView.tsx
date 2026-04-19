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
import { StateDot, Table } from '@niuulabs/ui';
import type { TableColumn } from '@niuulabs/ui';
import { useMimirSources } from './useMimirSources';
import type { Source } from '../domain/source';
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

const SOURCES_COLUMNS: TableColumn<Source>[] = [
  {
    key: 'id',
    header: 'ID / Origin',
    width: '140px',
    render: (row) => (
      <div>
        <div className="mm-source-id">{row.id.slice(0, 10)}</div>
        <span
          className={`mm-origin-badge mm-origin-badge--${row.originType}`}
          aria-label={`origin: ${row.originType}`}
        >
          {row.originType}
        </span>
      </div>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <div>
        <div className="mm-source-title">{row.title}</div>
        <p className="mm-source-meta">
          ingested {formatDate(row.ingestedAt)} · {row.ingestAgent}
        </p>
      </div>
    ),
  },
  {
    key: 'origin',
    header: 'Origin / Path',
    render: (row) =>
      row.originUrl ? (
        <span className="mm-source-url" title={row.originUrl}>
          {row.originUrl}
        </span>
      ) : row.originPath ? (
        <span className="mm-source-url mm-source-url--path">{row.originPath}</span>
      ) : (
        <span className="mm-source-null">—</span>
      ),
  },
  {
    key: 'compiledInto',
    header: 'Compiled into',
    render: (row) =>
      row.compiledInto.length > 0 ? (
        <div className="mm-source-compiled">
          {row.compiledInto.map((path) => (
            <span key={path} className="mm-source-path-chip">
              {path}
            </span>
          ))}
        </div>
      ) : (
        <span className="mm-source-null">not compiled yet</span>
      ),
  },
];

export function SourcesView() {
  const [activeOrigin, setActiveOrigin] = useState<OriginType | 'all'>('all');

  const {
    data: sources,
    isLoading,
    isError,
    error,
  } = useMimirSources(activeOrigin !== 'all' ? { originType: activeOrigin } : undefined);

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
        <div className="mm-status-row">
          <StateDot state="processing" pulse />
          <span className="mm-status-text">loading sources…</span>
        </div>
      )}

      {isError && (
        <p className="mm-sources-error">
          {error instanceof Error ? error.message : 'failed to load sources'}
        </p>
      )}

      {/* ── Source table ───────────────────────────────────────── */}
      {sources && (
        <>
          <p className="mm-source-count">
            {sources.length} source{sources.length !== 1 ? 's' : ''}
            {activeOrigin !== 'all' ? ` · origin: ${activeOrigin}` : ''}
          </p>
          <Table<Source> columns={SOURCES_COLUMNS} rows={sources} aria-label="sources table" />
        </>
      )}
    </div>
  );
}
