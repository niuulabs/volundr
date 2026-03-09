import { useEffect, useRef } from 'react';
import { Slash, Hammer } from 'lucide-react';
import type { SlashCommand } from './slashCommands';
import styles from './SlashCommandMenu.module.css';

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect }: SlashCommandMenuProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (commands.length === 0) {
    return (
      <div className={styles.menu}>
        <div className={styles.empty}>No matching commands</div>
      </div>
    );
  }

  return (
    <div className={styles.menu}>
      <ul className={styles.list} ref={listRef}>
        {commands.map((cmd, i) => (
          <li key={cmd.name}>
            <button
              type="button"
              className={styles.item}
              data-selected={i === selectedIndex}
              onClick={() => onSelect(cmd)}
            >
              {cmd.type === 'command' ? (
                <Slash className={styles.icon} />
              ) : (
                <Hammer className={styles.icon} />
              )}
              <span className={styles.name}>/{cmd.name}</span>
              <span className={styles.typeBadge}>{cmd.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
