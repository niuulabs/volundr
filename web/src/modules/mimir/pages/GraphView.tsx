import { useState, useEffect } from 'react';
import type { GraphNode, GraphEdge, MimirPageMeta, MimirStats, MimirPage } from '../api/types';
import * as mimirClient from '../api/client';
import { Graph } from '../components/Graph/Graph';
import { FileTree } from '../components/FileTree/FileTree';
import { PageViewer } from '../components/PageViewer/PageViewer';
import { PageEditor } from '../components/PageEditor/PageEditor';
import { StatsBar } from '../components/StatsBar/StatsBar';
import styles from './GraphView.module.css';

export function GraphView() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [pages, setPages] = useState<MimirPageMeta[]>([]);
  const [stats, setStats] = useState<MimirStats | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedPage, setSelectedPage] = useState<MimirPage | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [graphData, pageList, statsData] = await Promise.all([
          mimirClient.getGraph(),
          mimirClient.listPages(),
          mimirClient.getStats(),
        ]);
        if (cancelled) return;
        setNodes(graphData.nodes);
        setEdges(graphData.edges);
        setPages(pageList);
        setStats(statsData);
        setCategories(statsData.categories);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load graph data');
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

  function handleNodeClick(nodeId: string) {
    setSelectedPage(null);
    setSelectedNodeId(nodeId);
    setSelectedPath(nodeId);
    setShowEditor(false);
  }

  function handlePageSelect(path: string) {
    setSelectedPage(null);
    setSelectedPath(path);
    setSelectedNodeId(path);
    setShowEditor(false);
  }

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    setCategoryFilter(value === '' ? null : value);
  }

  function handleToggleEditor() {
    setShowEditor(prev => !prev);
  }

  async function handleSave(path: string, content: string): Promise<void> {
    await mimirClient.upsertPage(path, content);
    const updated = await mimirClient.getPage(path);
    setSelectedPage(updated);
  }

  const rightPanelTitle = showEditor ? 'Edit Page' : 'View Page';

  return (
    <div className={styles.page}>
      {stats && (
        <div className={styles.topBar}>
          <StatsBar stats={stats} />
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
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

        <section className={styles.graphArea}>
          <div className={styles.graphControls}>
            <span className={styles.controlLabel}>Category:</span>
            <select
              className={styles.categorySelect}
              value={categoryFilter ?? ''}
              onChange={handleCategoryChange}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.graphCanvas}>
            <Graph
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
              searchQuery={searchQuery}
              categoryFilter={categoryFilter}
            />
          </div>
        </section>

        <aside className={styles.rightPanel}>
          <div className={styles.rightPanelHeader}>
            <h2 className={styles.rightPanelTitle}>{rightPanelTitle}</h2>
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
          <div className={styles.rightPanelContent}>
            {!selectedPath && (
              <div className={styles.emptyState}>Select a node or page to view its content</div>
            )}
            {selectedPath && !showEditor && (
              <PageViewer page={selectedPage} onLinkClick={handlePageSelect} />
            )}
            {selectedPath && showEditor && <PageEditor page={selectedPage} onSave={handleSave} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
