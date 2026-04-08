import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MimirPage } from '@/domain';
import styles from './PageViewer.module.css';

interface PageViewerProps {
  page: MimirPage | null;
  onLinkClick: (path: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PageViewer({ page, onLinkClick }: PageViewerProps) {
  if (!page) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>Select a page to view</span>
      </div>
    );
  }

  return (
    <article className={styles.viewer}>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.categoryBadge}>{page.category}</span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span className={styles.metaItem} title="Last updated">
            <span className={styles.metaLabel}>Updated</span>
            <time dateTime={page.updatedAt}>{formatDate(page.updatedAt)}</time>
          </span>
          {page.sourceIds.length > 0 && (
            <>
              <span className={styles.metaDivider} aria-hidden="true" />
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Sources</span>
                <span>{page.sourceIds.length}</span>
              </span>
            </>
          )}
        </div>
        <h1 className={styles.title}>{page.title}</h1>
        <p className={styles.path}>{page.path}</p>
      </header>

      <div className={styles.content}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href && !href.startsWith('http') && !href.startsWith('//')) {
                return (
                  <a
                    href={href}
                    className={styles.internalLink}
                    onClick={(e) => {
                      e.preventDefault();
                      onLinkClick(href);
                    }}
                  >
                    {children}
                  </a>
                );
              }
              return (
                <a href={href} className={styles.externalLink} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {page.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
