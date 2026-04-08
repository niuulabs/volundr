import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MimirPageMeta } from '@/domain';
import { useActivePorts } from '@/contexts/PortsContext';
import { FileTree } from '@/ui/components/FileTree/FileTree';
import { PageViewer } from '@/ui/components/PageViewer/PageViewer';
import { PageEditor } from '@/ui/components/PageEditor/PageEditor';
import styles from './BrowserPage.module.css';

export function BrowserPage() {
  const { api } = useActivePorts();
  const [searchParams, setSearchParams] = useSearchParams();

  const [pages, setPages] = useState<MimirPageMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const selectedPath = searchParams.get('path');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const pageList = await api.listPages();
      if (!cancelled) {
        setPages(pageList);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  function handlePageSelect(path: string) {
    setSearchParams({ path });
    setShowEditor(false);
  }

  function handleToggleEditor() {
    setShowEditor((prev) => !prev);
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
            <PageViewer path={selectedPath} api={api} />
          )}
          {selectedPath && showEditor && (
            <PageEditor path={selectedPath} api={api} />
          )}
        </div>
      </main>
    </div>
  );
}
