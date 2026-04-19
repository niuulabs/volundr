import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionMenu } from './MentionMenu';
import type { MentionItem } from '../hooks/useMentionMenu';
import type { RoomParticipant } from '../types';

vi.mock('./MentionMenu.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  File: () => <span>FileIcon</span>,
  Folder: () => <span>FolderIcon</span>,
  FolderOpen: () => <span>FolderOpenIcon</span>,
  Loader2: () => <span>Loader2</span>,
}));

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: 'Alpha',
    color: 'p1',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

const fileItems: MentionItem[] = [
  { kind: 'file', entry: { name: 'index.ts', path: 'src/index.ts', type: 'file' }, depth: 0 },
  { kind: 'file', entry: { name: 'src', path: 'src', type: 'directory' }, depth: 0 },
];

const agentItems: MentionItem[] = [
  { kind: 'agent', participant: makeParticipant() },
];

describe('MentionMenu', () => {
  it('renders file items when provided', () => {
    render(
      <MentionMenu
        items={fileItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
  });

  it('renders agent items when provided', () => {
    render(
      <MentionMenu
        items={agentItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
  });

  it('shows "Agents" section header for agent items', () => {
    render(
      <MentionMenu
        items={agentItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('shows "Files & Directories" section header for file-only items', () => {
    render(
      <MentionMenu
        items={fileItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('Files & Directories')).toBeInTheDocument();
  });

  it('calls onSelect when clicking a file item', () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        items={fileItems}
        selectedIndex={0}
        loading={false}
        onSelect={onSelect}
        onExpand={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('index.ts'));
    expect(onSelect).toHaveBeenCalledWith(fileItems[0]);
  });

  it('calls onExpand when clicking a directory item', () => {
    const onExpand = vi.fn();
    render(
      <MentionMenu
        items={fileItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={onExpand}
      />
    );
    fireEvent.click(screen.getByText('src'));
    expect(onExpand).toHaveBeenCalledWith(fileItems[1]);
  });

  it('calls onSelect when clicking an agent item', () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        items={agentItems}
        selectedIndex={0}
        loading={false}
        onSelect={onSelect}
        onExpand={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Agent Alpha'));
    expect(onSelect).toHaveBeenCalledWith(agentItems[0]);
  });

  it('shows "No matches" when items list is empty and not loading', () => {
    render(
      <MentionMenu
        items={[]}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('shows loading state when loading=true and items are empty', () => {
    render(
      <MentionMenu
        items={[]}
        selectedIndex={0}
        loading={true}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });

  it('has data-testid="mention-menu"', () => {
    render(
      <MentionMenu
        items={fileItems}
        selectedIndex={0}
        loading={false}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByTestId('mention-menu')).toBeInTheDocument();
  });
});
