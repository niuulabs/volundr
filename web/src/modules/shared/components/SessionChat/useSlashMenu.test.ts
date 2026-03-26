import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSlashMenu } from './useSlashMenu';
import type { SlashCommand } from './slashCommands';

const testCommands: SlashCommand[] = [
  { name: 'help', type: 'command', description: 'Show help' },
  { name: 'clear', type: 'command', description: 'Clear chat' },
  { name: 'history', type: 'command', description: 'Show history' },
];

describe('useSlashMenu', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('opens when input starts with /', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('');
  });

  it('filters commands by name', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/hel');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('hel');
    expect(result.current.filteredCommands).toHaveLength(1);
    expect(result.current.filteredCommands[0].name).toBe('help');
  });

  it('closes when slash command includes a space', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/help ');
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('closes when text no longer starts with /', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.handleChange('hello');
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('selectCommand returns formatted command string and closes', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    let commandText = '';
    act(() => {
      commandText = result.current.selectCommand(testCommands[0]);
    });

    expect(commandText).toBe('/help ');
    expect(result.current.isOpen).toBe(false);
  });

  it('close() resets state', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/hel');
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('handleKeyDown returns false when menu is closed', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(false);
  });

  it('handleKeyDown Escape closes menu', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'Escape',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(true);
    expect(result.current.isOpen).toBe(false);
  });

  it('handleKeyDown ArrowDown cycles selection forward', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(result.current.selectedIndex).toBe(1);
  });

  it('handleKeyDown ArrowUp cycles selection backward', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowUp',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    // Wraps to last item (index 2 for 3 commands)
    expect(result.current.selectedIndex).toBe(2);
  });

  it('handleKeyDown Tab/Enter returns true when commands available', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'Tab',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(true);
  });

  it('handleKeyDown returns false for unhandled keys', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('/');
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'a',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(false);
  });

  it('works with multiline input, checking last line', () => {
    const { result } = renderHook(() => useSlashMenu(testCommands));

    act(() => {
      result.current.handleChange('first line\n/cl');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('cl');
    expect(result.current.filteredCommands).toHaveLength(1);
    expect(result.current.filteredCommands[0].name).toBe('clear');
  });

  it('defaults to empty commands when none provided', () => {
    const { result } = renderHook(() => useSlashMenu());

    act(() => {
      result.current.handleChange('/');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filteredCommands).toHaveLength(0);
  });
});
