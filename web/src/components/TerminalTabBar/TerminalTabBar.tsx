import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Plus, Lock, Unlock, ChevronDown } from 'lucide-react';
import type { TerminalTab } from '@/models';
import styles from './TerminalTabBar.module.css';

const CLI_OPTIONS = [
  { id: 'bash', label: 'Bash' },
  { id: 'zsh', label: 'Zsh' },
  { id: 'fish', label: 'Fish' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'aider', label: 'Aider' },
];

export interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  onAddCliTab?: (cliType: string) => void;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onAddCliTab,
}: TerminalTabBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const handleOptionClick = useCallback(
    (cliType: string) => {
      setDropdownOpen(false);
      // Always spawn via the server API so a tmux window is created
      if (onAddCliTab) {
        onAddCliTab(cliType);
        return;
      }
      // Fallback if no spawn handler
      onAddTab();
    },
    [onAddTab, onAddCliTab]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  return (
    <div className={styles.tabBarWrapper}>
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
        <div className={styles.addContainer} ref={dropdownRef}>
          <button
            ref={addBtnRef}
            className={styles.addButton}
            onClick={() => {
              setDropdownOpen(prev => {
                if (!prev && addBtnRef.current) {
                  const rect = addBtnRef.current.getBoundingClientRect();
                  setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                }
                return !prev;
              });
            }}
            aria-label="New terminal"
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
          >
            <Plus className={styles.addIcon} />
            <ChevronDown className={styles.chevronIcon} />
          </button>
          {dropdownOpen && dropdownPos && (
            <div
              className={styles.dropdown}
              role="menu"
              style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
            >
              {CLI_OPTIONS.map(option => (
                <button
                  key={option.id}
                  role="menuitem"
                  className={styles.dropdownItem}
                  onClick={() => handleOptionClick(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
