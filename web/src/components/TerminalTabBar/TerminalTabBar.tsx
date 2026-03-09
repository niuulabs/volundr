import { X, Plus, Lock, Unlock } from 'lucide-react';
import type { TerminalTab } from '@/models';
import styles from './TerminalTabBar.module.css';

export interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
}: TerminalTabBarProps) {
  return (
    <div className={styles.tabBar} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          data-active={tab.id === activeTabId}
          className={styles.tab}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.restricted ? (
            <Lock className={styles.modeIcon} />
          ) : (
            <Unlock className={styles.modeIcon} />
          )}
          <span className={styles.tabLabel}>{tab.label}</span>
          {tabs.length > 1 && (
            <span
              role="button"
              aria-label={`Close ${tab.label}`}
              className={styles.closeButton}
              onClick={e => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
              tabIndex={0}
            >
              <X className={styles.closeIcon} />
            </span>
          )}
        </button>
      ))}
      <button className={styles.addButton} onClick={onAddTab} aria-label="New terminal">
        <Plus className={styles.addIcon} />
      </button>
    </div>
  );
}
