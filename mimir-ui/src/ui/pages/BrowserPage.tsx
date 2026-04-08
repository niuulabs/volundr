import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MimirPageMeta, MimirPage } from '@/domain';
import { useActivePorts } from '@/contexts/PortsContext';
import { FileTree } from '@/ui/components/FileTree/FileTree';
import { PageViewer } from '@/ui/components/PageViewer/PageViewer';
import { PageEditor } from '@/ui/components/PageEditor/PageEditor';
import styles from './BrowserPage.module.css';

export function BrowserPage() {
  const { api, instance } = useActivePorts();
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
        const pageList = await api.listPages();
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
  }, [api]);

  // Fetch page content whenever selectedPath changes
  useEffect(() => {
    if (!selectedPath) {
      setSelectedPage(null);
      return;
    }
    let cancelled = false;
    api.getPage(selectedPath).then((page) => {
      if (!cancelled) setSelectedPage(page);
    }).catch(() => {
      if (!cancelled) setSelectedPage(null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, selectedPath]);

  function handlePageSelect(path: string) {
    setSearchParams({ path });
    setShowEditor(false);
  }

  function handleToggleEditor() {
    setShowEditor((prev) => !prev);
  }

  async function handleSave(path: string, content: string): Promise<void> {
    await api.upsertPage(path, content);
    const updated = await api.getPage(path);
    setSelectedPage(updated);
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSearch}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search pages…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
            <div className={styles.emptyState}>
              Select a page from the tree to view its content
            </div>
          )}
          {selectedPath && !showEditor && (
            <PageViewer
              page={selectedPage}
              onLinkClick={handlePageSelect}
            />
          )}
          {selectedPath && showEditor && (
            <PageEditor
              page={selectedPage}
              onSave={handleSave}
              writeEnabled={instance.writeEnabled}
            />
          )}
        </div>
      </main>
    </div>
  );
}
