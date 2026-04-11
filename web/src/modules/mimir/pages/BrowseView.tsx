import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MimirPageMeta, MimirPage } from '../api/types';
import * as mimirClient from '../api/client';
import { FileTree } from '../components/FileTree/FileTree';
import { PageViewer } from '../components/PageViewer/PageViewer';
import { PageEditor } from '../components/PageEditor/PageEditor';
import styles from './BrowseView.module.css';

export function BrowseView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [pages, setPages] = useState<MimirPageMeta[]>([]);
  const [selectedPage, setSelectedPage] = useState<MimirPage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPath = searchParams.get('path');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const pageList = await mimirClient.listPages();
        if (!cancelled) {
          setPages(pageList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load pages');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    mimirClient
      .getPage(selectedPath)
      .then(page => {
        if (!cancelled) setSelectedPage(page);
      })
      .catch(() => {
        if (!cancelled) setSelectedPage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  function handlePageSelect(path: string) {
    setSelectedPage(null);
    setSearchParams({ path });
    setShowEditor(false);
  }

  function handleToggleEditor() {
    setShowEditor(prev => !prev);
  }

  async function handleSave(path: string, content: string): Promise<void> {
    await mimirClient.upsertPage(path, content);
    const updated = await mimirClient.getPage(path);
    setSelectedPage(updated);
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSearch}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search pages"
          />
        </div>
        <div className={styles.sidebarTree}>
          <FileTree
            pages={pages}
            selectedPath={selectedPath}
            onSelect={handlePageSelect}
            searchQuery={searchQuery}
          />
        </div>
      </aside>

      <main className={styles.main}>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.mainHeader}>
          <h2 className={styles.pageTitle}>{selectedPath ?? 'No page selected'}</h2>
          {selectedPath && (
            <button
              className={styles.toggleButton}
              data-active={showEditor ? 'true' : 'false'}
              onClick={handleToggleEditor}
              type="button"
            >
              {showEditor ? 'View' : 'Edit'}
            </button>
          )}
        </div>
        <div className={styles.mainContent}>
          {!selectedPath && (
            <div className={styles.emptyState}>Select a page from the tree to view its content</div>
          )}
          {selectedPath && !showEditor && (
            <PageViewer page={selectedPage} onLinkClick={handlePageSelect} />
          )}
          {selectedPath && showEditor && <PageEditor page={selectedPage} onSave={handleSave} />}
        </div>
      </main>
    </div>
  );
}
