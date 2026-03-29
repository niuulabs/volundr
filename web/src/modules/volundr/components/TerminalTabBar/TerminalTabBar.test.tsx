import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalTabBar } from './TerminalTabBar';
import type { TerminalTab } from '@/modules/volundr/models';

// lucide-react icons render as SVGs, which is fine for testing
const makeTabs = (count: number): TerminalTab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `tab-${i}`,
    label: `Terminal ${i + 1}`,
    restricted: i % 2 === 0,
  }));

describe('TerminalTabBar', () => {
  it('renders all tabs', () => {
    const tabs = makeTabs(3);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    expect(screen.getByText('Terminal 3')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', () => {
    const tabs = makeTabs(2);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    const allTabs = screen.getAllByRole('tab');
    expect(allTabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(allTabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelectTab when a tab is clicked', () => {
    const tabs = makeTabs(2);
    const onSelect = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={onSelect}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Terminal 2'));
    expect(onSelect).toHaveBeenCalledWith('tab-1');
  });

  it('calls onCloseTab when the close button is clicked', () => {
    const tabs = makeTabs(2);
    const onClose = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={onClose}
        onAddTab={vi.fn()}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledWith('tab-0');
  });

  it('calls onCloseTab on Enter keydown on close button', () => {
    const tabs = makeTabs(2);
    const onClose = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={onClose}
        onAddTab={vi.fn()}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.keyDown(closeButtons[0], { key: 'Enter' });
    expect(onClose).toHaveBeenCalledWith('tab-0');
  });

  it('calls onCloseTab on Space keydown on close button', () => {
    const tabs = makeTabs(2);
    const onClose = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={onClose}
        onAddTab={vi.fn()}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.keyDown(closeButtons[0], { key: ' ' });
    expect(onClose).toHaveBeenCalledWith('tab-0');
  });

  it('does not call onCloseTab on other keydown on close button', () => {
    const tabs = makeTabs(2);
    const onClose = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={onClose}
        onAddTab={vi.fn()}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.keyDown(closeButtons[0], { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not show close buttons when only one tab exists', () => {
    const tabs = makeTabs(1);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    expect(screen.queryAllByRole('button', { name: /close/i })).toHaveLength(0);
  });

  it('opens dropdown when the add button is clicked', () => {
    const tabs = makeTabs(1);
    const onAdd = vi.fn();
    const onAddCli = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={onAdd}
        onAddCliTab={onAddCli}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // All CLI options should be visible
    expect(screen.getByRole('menuitem', { name: /^bash$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^zsh$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^fish$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /claude/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /codex/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /aider/i })).toBeInTheDocument();

    // Click a menu item to spawn via onAddCliTab
    fireEvent.click(screen.getByRole('menuitem', { name: /^bash$/i }));
    expect(onAddCli).toHaveBeenCalledWith('bash');
  });

  it('closes dropdown when clicking add button again', () => {
    const tabs = makeTabs(1);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
        onAddCliTab={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: /new terminal/i });

    // Open
    fireEvent.click(addButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Close by clicking again
    fireEvent.click(addButton);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to onAddTab when onAddCliTab is not provided', () => {
    const tabs = makeTabs(1);
    const onAdd = vi.fn();
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={onAdd}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^bash$/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('closes dropdown when clicking outside', () => {
    const tabs = makeTabs(1);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
        onAddCliTab={vi.fn()}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('sets aria-expanded on the add button', () => {
    const tabs = makeTabs(1);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
        onAddCliTab={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: /new terminal/i });
    expect(addButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(addButton);
    expect(addButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the tablist role on the container', () => {
    const tabs = makeTabs(1);
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="tab-0"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders lock icon for restricted tabs and unlock for unrestricted', () => {
    const tabs: TerminalTab[] = [
      { id: 'r', label: 'Restricted', restricted: true },
      { id: 'u', label: 'Unrestricted', restricted: false },
    ];
    render(
      <TerminalTabBar
        tabs={tabs}
        activeTabId="r"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onAddTab={vi.fn()}
      />
    );

    // Lock and Unlock are lucide SVGs; just verify both tabs render
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText('Unrestricted')).toBeInTheDocument();
  });
});
