import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionMenu } from './MentionMenu';
import type { MentionItem } from '../useMentionMenu';

const mockItems: MentionItem[] = [
  { entry: { name: 'src', path: 'src', type: 'directory' }, depth: 0 },
  { entry: { name: 'package.json', path: 'package.json', type: 'file' }, depth: 0 },
  { entry: { name: 'README.md', path: 'README.md', type: 'file' }, depth: 0 },
];

describe('MentionMenu', () => {
  it('renders items', () => {
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    expect(screen.getByText('src')).toBeDefined();
    expect(screen.getByText('package.json')).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
  });

  it('shows loading state when no items and loading', () => {
    render(
      <MentionMenu
        items={[]}
        selectedIndex={0}
        loading={true}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    expect(screen.getByText('Loading files...')).toBeDefined();
  });

  it('shows empty state when no items and not loading', () => {
    render(
      <MentionMenu
        items={[]}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    expect(screen.getByText('No matching files')).toBeDefined();
  });

  it('calls onSelect for file items', () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={onSelect}
        onExpand={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('package.json'));
    expect(onSelect).toHaveBeenCalledWith(mockItems[1]);
  });

  it('calls onExpand for directory items on click', () => {
    const onExpand = vi.fn();
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={onExpand}
      />
    );

    fireEvent.click(screen.getByText('src'));
    expect(onExpand).toHaveBeenCalledWith(mockItems[0]);
  });

  it('calls onSelect for directory items on double click', () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={onSelect}
        onExpand={vi.fn()}
      />
    );

    fireEvent.doubleClick(screen.getByText('src'));
    expect(onSelect).toHaveBeenCalledWith(mockItems[0]);
  });

  it('highlights selected item', () => {
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={1}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[1].dataset.selected).toBe('true');
    expect(buttons[0].dataset.selected).toBe('false');
  });

  it('shows dir badge for directory items', () => {
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    expect(screen.getByText('dir')).toBeDefined();
  });

  it('renders the menu with test id', () => {
    render(
      <MentionMenu
        items={mockItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );

    expect(screen.getByTestId('mention-menu')).toBeDefined();
  });
});
