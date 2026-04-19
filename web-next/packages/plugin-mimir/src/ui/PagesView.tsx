/**
 * PagesView — three-pane knowledge browser.
 *
 *  Left: file-tree sidebar (multi-mount union merge)
 * Centre: page reader (zones + zone-edit mode with optimistic locking)
 * Right:  page meta panel (provenance, sources, backlinks)
 */

import { useState, useReducer, Fragment } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useService } from '@niuulabs/plugin-sdk';
import { useMimirPages, useMimirPage, useMimirPageSources } from './useMimirPages';
import { PageTypeGlyph } from './components/PageTypeGlyph';
import { MountChip } from './components/MountChip';
import { WikilinkPill } from './components/WikilinkPill';
import { mergeFileTrees, countLeaves, resolveWikilink } from '../domain';
import { zoneEditReducer } from '../domain/zone-edit';
import type { ZoneEditState } from '../domain/zone-edit';
import type { FileTreeDir, FileTreeItem } from '../domain/tree';
import type { Page, Zone, ZoneKeyFacts, ZoneRelationships, ZoneAssessment, ZoneTimeline } from '../domain/page';
import type { PageMeta } from '../domain/page';
import type { IMimirService } from '../ports';
import './mimir-views.css';

// ---------------------------------------------------------------------------
// File tree sidebar
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: FileTreeItem;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ node, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(depth <= 1);
  const indent = depth * 12;

  if (!node.isDir) {
    const conf = node.page.confidence;
    return (
      <button
        type="button"
        className={`mm-tree-leaf${selectedPath === node.path ? ' mm-tree-leaf--active' : ''}`}
        style={{ paddingLeft: 12 + indent }}
        onClick={() => onSelect(node.path)}
        aria-current={selectedPath === node.path ? 'page' : undefined}
      >
        <span
          className={`mm-conf-dot mm-conf-dot--${conf}`}
          aria-label={`confidence: ${conf}`}
        />
        <span className="mm-tree-leaf__name">{node.name}</span>
        <PageTypeGlyph type={node.page.type} size={11} />
      </button>
    );
  }

  const childCount = countLeaves(node);

  return (
    <div className="mm-tree-dir">
      <div
        className="mm-tree-dir-head"
        style={{ paddingLeft: 4 + indent }}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
      >
        <span className="mm-tree-caret">{open ? '▾' : '▸'}</span>
        <span>{node.name}/</span>
        <span className="mm-tree-dir-count">{childCount}</span>
      </div>
      {open &&
        Object.values(node.children).map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone renderers
// ---------------------------------------------------------------------------

interface ZoneRendererProps {
  zone: Zone;
  pages: PageMeta[];
  onNavigate: (path: string) => void;
}

function KeyFactsZone({ zone, pages, onNavigate }: ZoneRendererProps & { zone: ZoneKeyFacts }) {
  return (
    <ul>
      {zone.items.map((item, i) => {
        const parts = item.split(/(\[\[[^\]]+]])/g);
        return (
          <li key={i}>
            {parts.map((part, j) => {
              if (part.startsWith('[[') && part.endsWith(']]')) {
                const slug = part.slice(2, -2);
                const target = resolveWikilink(slug, pages);
                return (
                  <WikilinkPill
                    key={j}
                    slug={slug}
                    broken={target.broken}
                    onNavigate={onNavigate}
                  />
                );
              }
              return <Fragment key={j}>{part}</Fragment>;
            })}
          </li>
        );
      })}
    </ul>
  );
}

function RelationshipsZone({
  zone,
  pages,
  onNavigate,
}: ZoneRendererProps & { zone: ZoneRelationships }) {
  return (
    <ul>
      {zone.items.map((rel, i) => {
        const target = resolveWikilink(rel.slug, pages);
        return (
          <li key={i}>
            <WikilinkPill
              slug={rel.slug}
              broken={target.broken}
              onNavigate={onNavigate}
            />
            {rel.note && (
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 6 }}>
                — {rel.note}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AssessmentZone({ zone }: { zone: ZoneAssessment }) {
  return <p>{zone.text}</p>;
}

function TimelineZone({ zone }: { zone: ZoneTimeline }) {
  return (
    <div>
      {zone.items.map((entry, i) => (
        <div key={i} className="mm-timeline-entry">
          <span className="mm-timeline-date">{entry.date}</span>
          <span className="mm-timeline-note">{entry.note}</span>
        </div>
      ))}
      {zone.items.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
          no timeline entries yet
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone-edit wrapper
// ---------------------------------------------------------------------------

const ZONE_LABELS: Record<string, string> = {
  'key-facts': 'Key facts',
  relationships: 'Relationships',
  assessment: 'Assessment',
  timeline: 'Timeline',
};

interface ZoneBlockProps {
  zone: Zone;
  pagePath: string;
  pageMounts: string[];
  allPages: PageMeta[];
  onNavigate: (path: string) => void;
  editState: ZoneEditState;
  onEdit: (zone: Zone) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ZoneBlock({
  zone,
  pagePath,
  pageMounts,
  allPages,
  onNavigate,
  editState,
  onEdit,
  onSave,
  onCancel,
}: ZoneBlockProps) {
  const isEditingThis =
    editState.status === 'editing' &&
    editState.path === pagePath &&
    editState.zoneKind === zone.kind;
  const isSavingThis =
    editState.status === 'saving' && editState.path === pagePath;
  const isSaved = editState.status === 'saved' && editState.path === pagePath;
  const isError = editState.status === 'error' && editState.path === pagePath;

  const canEdit = editState.status === 'idle';
  const label = ZONE_LABELS[zone.kind] ?? zone.kind;

  return (
    <div className={`mm-zone${isEditingThis ? ' mm-zone--editing' : ''}`}>
      <div className="mm-zone-head">
        <span className="mm-zone-title">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {isSavingThis && (
            <StateDot state="processing" pulse />
          )}
          {canEdit && !isEditingThis && (
            <button
              type="button"
              className="mm-btn"
              onClick={() => onEdit(zone)}
              aria-label={`edit ${zone.kind} zone`}
            >
              ✎ edit
            </button>
          )}
          {isEditingThis && (
            <>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                onClick={onSave}
                aria-label={`save ${zone.kind} zone`}
              >
                save
              </button>
              <button
                type="button"
                className="mm-btn"
                onClick={onCancel}
                aria-label="cancel edit"
              >
                cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mm-zone-body">
        {isSaved && (
          <div className="mm-save-banner">
            ✓ saved → {pageMounts.map((m) => <MountChip key={m} name={m} />)}
          </div>
        )}
        {isError && editState.status === 'error' && (
          <div className="mm-error-banner">{editState.message}</div>
        )}

        {isEditingThis ? (
          <EditZoneBody zone={editState.draft} />
        ) : (
          <ZoneBodyReadonly zone={zone} allPages={allPages} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

function EditZoneBody({ zone }: { zone: Zone }) {
  const text = zoneToEditableText(zone);
  return (
    <div className="mm-zone-edit-footer" style={{ flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'stretch' }}>
      <textarea
        className="mm-zone-edit-area"
        defaultValue={text}
        aria-label="zone edit area"
      />
      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          margin: 0,
        }}
      >
        Editing {zone.kind} zone — changes will be written to the destination mount.
      </p>
    </div>
  );
}

function ZoneBodyReadonly({
  zone,
  allPages,
  onNavigate,
}: {
  zone: Zone;
  allPages: PageMeta[];
  onNavigate: (path: string) => void;
}) {
  switch (zone.kind) {
    case 'key-facts':
      return <KeyFactsZone zone={zone} pages={allPages} onNavigate={onNavigate} />;
    case 'relationships':
      return <RelationshipsZone zone={zone} pages={allPages} onNavigate={onNavigate} />;
    case 'assessment':
      return <AssessmentZone zone={zone} />;
    case 'timeline':
      return <TimelineZone zone={zone} />;
  }
}

function zoneToEditableText(zone: Zone): string {
  switch (zone.kind) {
    case 'key-facts':
      return zone.items.join('\n');
    case 'relationships':
      return zone.items.map((r) => `[[${r.slug}]] — ${r.note}`).join('\n');
    case 'assessment':
      return zone.text;
    case 'timeline':
      return zone.items.map((t) => `${t.date}: ${t.note}`).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Right meta panel
// ---------------------------------------------------------------------------

interface MetaPanelProps {
  page: Page;
  sources: { id: string; title: string; originType: string }[];
  allPages: PageMeta[];
  onNavigate: (path: string) => void;
}

function MetaPanel({ page, sources, allPages, onNavigate }: MetaPanelProps) {
  const backlinks = allPages.filter(
    (p) => p.related?.some((slug) => page.path.includes(slug)),
  );

  return (
    <div className="mm-rightpanel">
      <div className="mm-meta-block">
        <h5>Provenance</h5>
        <div className="mm-meta-row">
          <span className="mm-meta-k">path</span>
          <span className="mm-meta-v" style={{ fontFamily: 'var(--font-mono)' }}>{page.path}</span>
        </div>
        <div className="mm-meta-row">
          <span className="mm-meta-k">type</span>
          <span className="mm-meta-v">
            <PageTypeGlyph type={page.type} showLabel />
          </span>
        </div>
        <div className="mm-meta-row">
          <span className="mm-meta-k">confidence</span>
          <span className="mm-meta-v">{page.confidence}</span>
        </div>
        <div className="mm-meta-row">
          <span className="mm-meta-k">updated</span>
          <span className="mm-meta-v">{page.updatedAt.slice(0, 10)}</span>
        </div>
        <div className="mm-meta-row">
          <span className="mm-meta-k">by</span>
          <span className="mm-meta-v">{page.updatedBy}</span>
        </div>
      </div>

      <div className="mm-meta-block">
        <h5>Lives on</h5>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
          {page.mounts.map((m) => (
            <MountChip key={m} name={m} />
          ))}
        </div>
      </div>

      {sources.length > 0 && (
        <div className="mm-meta-block">
          <h5>Sources ({sources.length})</h5>
          {sources.map((s) => (
            <div key={s.id} className="mm-source-pill">
              <span className="mm-source-pill__id">{s.id.slice(0, 8)}</span>
              <span className="mm-source-pill__title" title={s.title}>{s.title}</span>
            </div>
          ))}
        </div>
      )}

      {backlinks.length > 0 && (
        <div className="mm-meta-block">
          <h5>Backlinks ({backlinks.length})</h5>
          {backlinks.slice(0, 6).map((p) => (
            <button
              key={p.path}
              type="button"
              className="mm-btn"
              style={{ display: 'block', marginBottom: 'var(--space-1)', width: '100%', textAlign: 'left' }}
              onClick={() => onNavigate(p.path)}
            >
              ↩ {p.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PagesView root
// ---------------------------------------------------------------------------

export function PagesView() {
  const { data: allPages = [] } = useMimirPages();
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => allPages[0]?.path ?? null,
  );
  const { data: page } = useMimirPage(selectedPath ?? allPages[0]?.path ?? null);
  const { data: pageSources = [] } = useMimirPageSources(
    selectedPath ?? allPages[0]?.path ?? null,
  );
  const service = useService<IMimirService>('mimir');

  const [editState, dispatch] = useReducer(zoneEditReducer, { status: 'idle' });

  const tree = mergeFileTrees(allPages);
  const activePagePath = selectedPath ?? allPages[0]?.path ?? null;

  function handleNavigate(slug: string) {
    const target = allPages.find((p) => p.path.includes(slug));
    if (target) setSelectedPath(target.path);
  }

  function handleEdit(zone: Zone) {
    if (!activePagePath) return;
    dispatch({ type: 'START_EDIT', path: activePagePath, zoneKind: zone.kind, zone });
  }

  async function handleSave() {
    if (!page || editState.status !== 'editing') return;
    const mounts = page.mounts;
    dispatch({ type: 'BEGIN_SAVE', destinationMounts: mounts });
    try {
      await service.pages.upsertPage(page.path, JSON.stringify(editState.draft), mounts[0]);
      dispatch({ type: 'SAVE_SUCCESS', savedAt: new Date().toISOString() });
      setTimeout(() => dispatch({ type: 'RESET' }), 3000);
    } catch (err) {
      dispatch({
        type: 'SAVE_ERROR',
        message: err instanceof Error ? err.message : 'save failed',
      });
    }
  }

  function handleCancel() {
    dispatch({ type: 'CANCEL' });
  }

  const currentPath = page?.path;
  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="mm-pages-root">
      {/* ── File tree sidebar ──────────────────────────────────── */}
      <aside className="mm-sidepanel" aria-label="page tree">
        <div className="mm-sidepanel__head">
          <span className="mm-sidepanel__head-label">Pages</span>
          <span className="mm-sidepanel__count">{allPages.length}</span>
        </div>
        <div className="mm-scroll">
          {Object.values(tree.children).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={0}
              selectedPath={activePagePath}
              onSelect={setSelectedPath}
            />
          ))}
        </div>
      </aside>

      {/* ── Page reader ────────────────────────────────────────── */}
      <main className="mm-body">
        {page ? (
          <div className="mm-scroll">
            <div className="mm-page-wrap">
              {/* breadcrumbs */}
              <div className="mm-page-crumbs" aria-label="breadcrumb">
                {breadcrumbs.slice(0, -1).map((part, i) => (
                  <Fragment key={i}>
                    <span>{part}</span>
                    <span className="sep">/</span>
                  </Fragment>
                ))}
                <span className="leaf">{breadcrumbs[breadcrumbs.length - 1]}</span>
              </div>

              <h1 className="mm-page-title">{page.title}</h1>
              <p className="mm-page-summary">{page.summary}</p>

              {/* action bar */}
              <div className="mm-action-bar">
                <div className="mm-chip-bar">
                  <span className="mm-chip">
                    <span className="mm-chip-k">type</span> {page.type}
                  </span>
                  <span className="mm-chip">
                    <span className="mm-chip-k">confidence</span> {page.confidence}
                  </span>
                  {page.mounts.map((m) => (
                    <MountChip key={m} name={m} />
                  ))}
                </div>
              </div>

              {/* zones */}
              {(page.zones ?? []).map((zone, i) => (
                <ZoneBlock
                  key={i}
                  zone={zone}
                  pagePath={page.path}
                  pageMounts={page.mounts}
                  allPages={allPages}
                  onNavigate={handleNavigate}
                  editState={editState}
                  onEdit={handleEdit}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              ))}

              {(!page.zones || page.zones.length === 0) && (
                <p
                  style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-sm)',
                    fontStyle: 'italic',
                  }}
                >
                  No zones — page will be populated on the next dream cycle.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Select a page from the tree
          </div>
        )}
      </main>

      {/* ── Meta panel ─────────────────────────────────────────── */}
      <aside aria-label="page metadata">
        {page && (
          <MetaPanel
            page={page}
            sources={pageSources}
            allPages={allPages}
            onNavigate={handleNavigate}
          />
        )}
      </aside>
    </div>
  );
}
