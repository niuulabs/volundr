/**
 * PagesView — three-pane knowledge browser.
 *
 *  Left: file-tree sidebar (multi-mount union merge)
 * Centre: page reader (zones + zone-edit mode with optimistic locking)
 * Right:  page meta panel (provenance, sources, backlinks)
 */

import { useState, useReducer, useEffect, useRef, Fragment } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import { useMimirPages, useMimirPage, useMimirPageSources } from './useMimirPages';
import { TreeNode } from './components/TreeNode';
import { ZoneBlock } from './components/ZoneBlock';
import { MetaPanel } from './components/MetaPanel';
import { MountChip } from './components/MountChip';
import { mergeFileTrees } from '../domain';
import { zoneEditReducer } from '../domain/zone-edit';
import type { Zone } from '../domain/page';
import type { IMimirService } from '../ports';
import './mimir-views.css';

/** Delay (ms) before auto-resetting zone edit state after a successful save. */
const ZONE_SAVE_RESET_DELAY_MS = 3_000;

export function PagesView() {
  const { data: allPages = [] } = useMimirPages();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Auto-select the first page once data loads.
  useEffect(() => {
    if (selectedPath === null && allPages.length > 0) {
      setSelectedPath(allPages[0]?.path ?? null);
    }
  }, [allPages, selectedPath]);

  const activePagePath = selectedPath ?? allPages[0]?.path ?? null;
  const { data: page } = useMimirPage(activePagePath);
  const { data: pageSources = [] } = useMimirPageSources(activePagePath);
  const service = useService<IMimirService>('mimir');

  const [editState, dispatch] = useReducer(zoneEditReducer, { status: 'idle' });
  const saveResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending reset timer on unmount.
  useEffect(() => {
    return () => {
      if (saveResetTimerRef.current !== null) clearTimeout(saveResetTimerRef.current);
    };
  }, []);

  const tree = mergeFileTrees(allPages);

  function handleNavigate(slug: string) {
    const target = allPages.find((p) => p.path === `/${slug}` || p.path === slug);
    if (target) setSelectedPath(target.path);
  }

  function handleEdit(zone: Zone) {
    if (!activePagePath) return;
    dispatch({ type: 'START_EDIT', path: activePagePath, zoneKind: zone.kind, zone });
  }

  async function handleSave(text: string) {
    if (!page || editState.status !== 'editing') return;
    const mounts = page.mounts;
    dispatch({ type: 'BEGIN_SAVE', destinationMounts: mounts });
    try {
      await service.pages.upsertPage(page.path, text, mounts[0]);
      dispatch({ type: 'SAVE_SUCCESS', savedAt: new Date().toISOString() });
      saveResetTimerRef.current = setTimeout(
        () => dispatch({ type: 'RESET' }),
        ZONE_SAVE_RESET_DELAY_MS,
      );
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

  const breadcrumbs = activePagePath ? activePagePath.split('/').filter(Boolean) : [];

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
                <p className="mm-no-zones">
                  No zones — page will be populated on the next dream cycle.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="mm-no-selection">Select a page from the tree</div>
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
