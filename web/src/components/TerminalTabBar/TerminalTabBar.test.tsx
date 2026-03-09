import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalTabBar } from './TerminalTabBar';
import type { TerminalTab } from '@/models';

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

  it('calls onAddTab when the add button is clicked', () => {
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
    expect(onAdd).toHaveBeenCalledTimes(1);
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
});
