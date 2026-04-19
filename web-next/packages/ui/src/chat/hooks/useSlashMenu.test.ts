import { renderHook, act } from '@testing-library/react';
import { useSlashMenu } from './useSlashMenu';
import type { SlashCommand } from '../types';

const commands: SlashCommand[] = [
  { name: 'init', type: 'command' },
  { name: 'deploy', type: 'command' },
  { name: 'review', type: 'skill' },
];

describe('useSlashMenu', () => {
  it('is initially closed', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    expect(result.current.isOpen).toBe(false);
  });

  it('starts with empty filter and selectedIndex 0', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('typing "/" opens the menu with empty filter', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('');
  });

  it('typing "/foo" sets filter to "foo"', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/foo');
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('foo');
  });

  it('typing "/foo bar" (space after command) closes the menu', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/init');
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.handleChange('/init ');
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('ArrowDown cycles selectedIndex forward', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('ArrowUp cycles selectedIndex backward', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    // Go to index 1
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('Escape closes the menu', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    act(() => {
      result.current.handleKeyDown({ key: 'Escape', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('handleKeyDown returns true when Escape is pressed while open', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({ key: 'Escape', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(handled).toBe(true);
  });

  it('handleKeyDown returns false when menu is closed', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent);
    });
    expect(handled).toBe(false);
  });

  it('selectCommand returns "/name " string and closes the menu', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/');
    });
    let selected = '';
    act(() => {
      selected = result.current.selectCommand(commands[0]!);
    });
    expect(selected).toBe('/init ');
    expect(result.current.isOpen).toBe(false);
  });

  it('filteredCommands filters by name when filter is set', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/dep');
    });
    expect(result.current.filteredCommands).toHaveLength(1);
    expect(result.current.filteredCommands[0]?.name).toBe('deploy');
  });

  it('close() closes the menu and resets state', () => {
    const { result } = renderHook(() => useSlashMenu(commands));
    act(() => {
      result.current.handleChange('/foo');
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('works with no commands provided', () => {
    const { result } = renderHook(() => useSlashMenu());
    act(() => {
      result.current.handleChange('/');
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filteredCommands).toHaveLength(0);
  });
});
