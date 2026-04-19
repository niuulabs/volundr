import { useState, useCallback, useMemo } from 'react';
import type { SlashCommand } from '../types';

const EMPTY_COMMANDS: SlashCommand[] = [];

interface UseSlashMenuReturn {
  isOpen: boolean;
  filter: string;
  selectedIndex: number;
  filteredCommands: SlashCommand[];
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  handleChange: (value: string) => void;
  selectCommand: (cmd: SlashCommand) => string;
  close: () => void;
}

export function useSlashMenu(commands: SlashCommand[] = EMPTY_COMMANDS): UseSlashMenuReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(
    () => commands.filter(cmd => cmd.name.toLowerCase().includes(filter.toLowerCase())),
    [commands, filter]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setFilter('');
    setSelectedIndex(0);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      const lines = value.split('\n');
      const lastLine = lines[lines.length - 1] ?? '';

      if (lastLine.startsWith('/')) {
        const filterText = lastLine.slice(1).split(' ')[0] ?? '';
        if (lastLine.slice(1).includes(' ')) {
          setIsOpen(false);
          setFilter('');
          setSelectedIndex(0);
          return;
        }
        setIsOpen(true);
        setFilter(filterText ?? '');
        setSelectedIndex(0);
        return;
      }

      if (isOpen) {
        setIsOpen(false);
        setFilter('');
        setSelectedIndex(0);
      }
    },
    [isOpen]
  );

  const selectCommand = useCallback((cmd: SlashCommand): string => {
    const result = `/${cmd.name} `;
    setIsOpen(false);
    setFilter('');
    setSelectedIndex(0);
    return result;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) return false;

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        setFilter('');
        setSelectedIndex(0);
        return true;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(filteredCommands.length, 1));
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          prev => (prev - 1 + filteredCommands.length) % Math.max(filteredCommands.length, 1)
        );
        return true;
      }

      if (e.key === 'Tab' || e.key === 'Enter') {
        if (filteredCommands.length > 0) {
          e.preventDefault();
          return true;
        }
      }

      return false;
    },
    [isOpen, filteredCommands.length]
  );

  return { isOpen, filter, selectedIndex, filteredCommands, handleKeyDown, handleChange, selectCommand, close };
}
