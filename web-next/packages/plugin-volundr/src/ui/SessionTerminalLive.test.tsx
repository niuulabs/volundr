import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { deriveHttpBase, listSessions, SessionTerminalLive, spawnSession } from './SessionTerminalLive';

vi.mock('@niuulabs/query', () => ({
  getAccessToken: vi.fn(() => 'token-123'),
}));

describe('SessionTerminalLive helpers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('derives the HTTP base from websocket URLs', () => {
    expect(deriveHttpBase('ws://localhost:8080/ws')).toBe('http://localhost:8080');
    expect(deriveHttpBase('wss://example.com/prefix/ws')).toBe('https://example.com/prefix');
  });

  it('lists sessions with auth headers and handles missing/failed backends', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [{ terminalId: 'term-1', label: 'Main', cli_type: 'shell', status: 'running' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(listSessions('https://example.com')).resolves.toBeNull();
    await expect(listSessions('https://example.com')).resolves.toEqual([]);
    await expect(listSessions('https://example.com')).resolves.toEqual([
      { terminalId: 'term-1', label: 'Main', cli_type: 'shell', status: 'running' },
    ]);

    expect(global.fetch).toHaveBeenLastCalledWith('https://example.com/api/terminal/sessions', {
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('spawns a terminal session with the selected CLI type', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ terminalId: 'term-2', label: 'Shell 2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(spawnSession('https://example.com', 'shell')).resolves.toEqual({
      terminalId: 'term-2',
      label: 'Shell 2',
    });

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/api/terminal/spawn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ cli_type: 'shell' }),
    });
  });
});

describe('SessionTerminalLive', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders a fallback when no websocket URL is available', () => {
    render(<SessionTerminalLive url={null} />);
    expect(screen.getByText('terminal unavailable')).toBeInTheDocument();
  });

  it('renders the legacy-transport notice when the backend does not expose terminal sessions', async () => {
    render(<SessionTerminalLive url="ws://localhost:8080/ws" />);
    await waitFor(() =>
      expect(
        screen.getByText('This backend does not expose the legacy terminal transport yet.'),
      ).toBeInTheDocument(),
    );
  });
});
