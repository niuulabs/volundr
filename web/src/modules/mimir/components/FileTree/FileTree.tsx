import { useState } from 'react';
import type { MimirPageMeta } from '../../api/types';
import styles from './FileTree.module.css';

interface FileTreeProps {
  pages: MimirPageMeta[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  searchQuery?: string;
}

interface CategoryGroup {
  category: string;
  pages: MimirPageMeta[];
}

function groupByCategory(pages: MimirPageMeta[]): CategoryGroup[] {
  const map = new Map<string, MimirPageMeta[]>();

  for (const page of pages) {
    const existing = map.get(page.category) ?? [];
    existing.push(page);
    map.set(page.category, existing);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, categoryPages]) => ({
      category,
      pages: categoryPages.sort((a, b) => a.title.localeCompare(b.title)),
    }));
}

export function FileTree({ pages, selectedPath, onSelect, searchQuery = '' }: FileTreeProps) {
  const filteredPages = searchQuery.trim()
    ? pages.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : pages;
  const groups = groupByCategory(filteredPages);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCategory = (category: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>No pages found</span>
      </div>
    );
  }

  return (
    <nav className={styles.tree} aria-label="Page browser">
      {groups.map(({ category, pages: categoryPages }) => {
        const isCollapsed = collapsed.has(category);

        return (
          <div key={category} className={styles.categoryGroup}>
            <button
              className={styles.categoryHeader}
              onClick={() => toggleCategory(category)}
              aria-expanded={!isCollapsed}
            >
              <span className={styles.chevron} data-collapsed={isCollapsed} aria-hidden="true">
                &#x25BE;
              </span>
              <span className={styles.categoryName}>{category}</span>
              <span className={styles.pageCount}>{categoryPages.length}</span>
            </button>

            {!isCollapsed && (
              <ul className={styles.pageList} role="list">
                {categoryPages.map(page => (
                  <li key={page.path} className={styles.pageItem}>
                    <button
                      className={styles.pageButton}
                      data-selected={page.path === selectedPath}
                      onClick={() => onSelect(page.path)}
                      title={page.path}
                    >
                      <span className={styles.pageTitle}>{page.title}</span>
                      {page.sourceIds.length > 0 && (
                        <span
                          className={styles.sourceCount}
                          title={`${page.sourceIds.length} source(s)`}
                        >
                          {page.sourceIds.length}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
