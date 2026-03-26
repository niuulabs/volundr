import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
import type { PlanningMessage } from '../../models/planning';

const mockMessages: PlanningMessage[] = [
  {
    id: 'msg-1',
    content: 'Should we split the auth phase?',
    sender: 'user',
    created_at: '2026-03-25T10:00:00Z',
  },
  {
    id: 'msg-2',
    content: 'Yes, splitting into middleware and token validation would be cleaner.',
    sender: 'system',
    created_at: '2026-03-25T10:01:00Z',
  },
];

describe('ChatPanel', () => {
  it('renders empty state when no messages', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    expect(screen.getByText(/start the conversation/i)).toBeInTheDocument();
  });

  it('renders messages with correct sender attribution', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={mockMessages} onSend={onSend} />);

    expect(screen.getByText('Should we split the auth phase?')).toBeInTheDocument();
    expect(screen.getByText(/splitting into middleware/)).toBeInTheDocument();
  });

  it('renders sender labels', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={mockMessages} onSend={onSend} />);

    const senders = screen.getAllByText(/user|system/);
    expect(senders.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onSend when form is submitted with content', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText(/discuss/i);
    await user.type(input, 'What about adding a caching layer?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('What about adding a caching layer?');
  });

  it('clears input after sending', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText(/discuss/i) as HTMLInputElement;
    await user.type(input, 'Test message');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(input.value).toBe('');
  });

  it('does not send empty messages', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input and button when disabled prop is true', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} disabled />);

    const input = screen.getByPlaceholderText(/discuss/i) as HTMLInputElement;
    const button = screen.getByRole('button', { name: /send/i });

    expect(input.disabled).toBe(true);
    expect(button).toBeDisabled();
  });

  it('renders message data-sender attributes', () => {
    const onSend = vi.fn();
    const { container } = render(<ChatPanel messages={mockMessages} onSend={onSend} />);

    const userMsg = container.querySelector('[data-sender="user"]');
    const systemMsg = container.querySelector('[data-sender="system"]');

    expect(userMsg).toBeInTheDocument();
    expect(systemMsg).toBeInTheDocument();
  });
});
