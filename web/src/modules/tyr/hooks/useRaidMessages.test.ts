import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRaidMessages } from './useRaidMessages';

const mockMessages = [
  {
    id: 'm-1',
    session_id: 's-1',
    content: 'Hello',
    sender: 'user',
    created_at: '2026-03-27T00:00:00Z',
  },
];

describe('useRaidMessages', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockMessages,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when raidId is null', async () => {
    const { result } = renderHook(() => useRaidMessages(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch messages when raidId is provided', async () => {
    const { result } = renderHook(() => useRaidMessages('raid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useRaidMessages('raid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string error');
    const { result } = renderHook(() => useRaidMessages('raid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('should send a message and append it', async () => {
    const newMsg = {
      id: 'm-2',
      session_id: 's-1',
      content: 'Hi',
      sender: 'user',
      created_at: '2026-03-27T01:00:00Z',
    };
    const { result } = renderHook(() => useRaidMessages('raid-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => newMsg,
    } as Response);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });
    expect(result.current.messages).toHaveLength(2);
  });

  it('sendMessage should noop when raidId is null', async () => {
    const { result } = renderHook(() => useRaidMessages(null));
    await act(async () => {
      await result.current.sendMessage('test');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
