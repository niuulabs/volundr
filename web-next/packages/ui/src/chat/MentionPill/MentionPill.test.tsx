import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionPill } from './MentionPill';
import type { SelectedMention } from '../hooks/useMentionMenu';
import type { RoomParticipant } from '../types';

vi.mock('./MentionPill.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  X: () => <span>X</span>,
  File: () => <span>FileIcon</span>,
  Folder: () => <span>FolderIcon</span>,
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

describe('MentionPill', () => {
  describe('file mention', () => {
    const fileMention: SelectedMention = {
      kind: 'file',
      entry: { name: 'index.ts', path: 'src/index.ts', type: 'file' },
    };

    it('renders with file path', () => {
      render(<MentionPill mention={fileMention} onRemove={vi.fn()} />);
      expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    });

    it('has data-kind="file"', () => {
      render(<MentionPill mention={fileMention} onRemove={vi.fn()} />);
      expect(screen.getByTestId('mention-pill')).toHaveAttribute('data-kind', 'file');
    });

    it('clicking remove button calls onRemove with file path', () => {
      const onRemove = vi.fn();
      render(<MentionPill mention={fileMention} onRemove={onRemove} />);
      const removeBtn = screen.getByRole('button', { name: /remove src\/index\.ts/i });
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith('src/index.ts');
    });
  });

  describe('directory mention', () => {
    const dirMention: SelectedMention = {
      kind: 'file',
      entry: { name: 'src', path: 'src', type: 'directory' },
    };

    it('renders with directory path', () => {
      render(<MentionPill mention={dirMention} onRemove={vi.fn()} />);
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    it('has data-type="directory"', () => {
      render(<MentionPill mention={dirMention} onRemove={vi.fn()} />);
      expect(screen.getByTestId('mention-pill')).toHaveAttribute('data-type', 'directory');
    });
  });

  describe('agent mention', () => {
    const agentMention: SelectedMention = {
      kind: 'agent',
      participant: makeParticipant({ persona: 'Agent Alpha', peerId: 'peer-1' }),
    };

    it('renders with agent persona', () => {
      render(<MentionPill mention={agentMention} onRemove={vi.fn()} />);
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    it('has data-kind="agent"', () => {
      render(<MentionPill mention={agentMention} onRemove={vi.fn()} />);
      expect(screen.getByTestId('mention-pill')).toHaveAttribute('data-kind', 'agent');
    });

    it('clicking remove calls onRemove with peerId', () => {
      const onRemove = vi.fn();
      render(<MentionPill mention={agentMention} onRemove={onRemove} />);
      const removeBtn = screen.getByRole('button', { name: /remove @agent alpha/i });
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith('peer-1');
    });
  });
});
