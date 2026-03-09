import { useEffect, useRef } from 'react';
import { File, Folder, FolderOpen, Loader2 } from 'lucide-react';
import type { MentionItem } from '../useMentionMenu';
import styles from './MentionMenu.module.css';

interface MentionMenuProps {
  items: MentionItem[];
  selectedIndex: number;
  loading: boolean;
  onSelect: (item: MentionItem) => void;
  onExpand: (item: MentionItem) => void;
}

export function MentionMenu({
  items,
  selectedIndex,
  loading,
  onSelect,
  onExpand,
}: MentionMenuProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    if (typeof selected?.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (loading && items.length === 0) {
    return (
      <div className={styles.menu} data-testid="mention-menu">
        <div className={styles.loading}>
          <Loader2 className={styles.spinner} />
          <span>Loading files...</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.menu} data-testid="mention-menu">
        <div className={styles.empty}>No matching files</div>
      </div>
    );
  }

  return (
    <div className={styles.menu} data-testid="mention-menu">
      <div className={styles.header}>Files &amp; Directories</div>
      <ul className={styles.list} ref={listRef}>
        {items.map((item, i) => (
          <li key={item.entry.path}>
            <button
              type="button"
              className={styles.item}
              data-selected={i === selectedIndex}
              data-type={item.entry.type}
              onClick={() => {
                if (item.entry.type === 'directory') {
                  onExpand(item);
                  return;
                }
                onSelect(item);
              }}
              onDoubleClick={() => {
                if (item.entry.type === 'directory') {
                  onSelect(item);
                }
              }}
            >
              <span className={styles.indent} data-depth={item.depth} />
              {item.entry.type === 'directory' ? (
                i === selectedIndex ? (
                  <FolderOpen className={styles.iconFolder} />
                ) : (
                  <Folder className={styles.iconFolder} />
                )
              ) : (
                <File className={styles.iconFile} />
              )}
              <span className={styles.name}>{item.entry.name}</span>
              {item.entry.type === 'directory' && <span className={styles.typeBadge}>dir</span>}
            </button>
          </li>
        ))}
      </ul>
      {loading && (
        <div className={styles.loadingBar}>
          <Loader2 className={styles.spinnerSmall} />
        </div>
      )}
    </div>
  );
}
