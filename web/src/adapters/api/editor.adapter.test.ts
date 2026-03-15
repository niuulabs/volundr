import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiEditorAdapter } from './editor.adapter';

describe('ApiEditorAdapter', () => {
  let adapter: ApiEditorAdapter;

  beforeEach(() => {
    adapter = new ApiEditorAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return remoteAuthority matching hostname', () => {
    const config = adapter.getWorkbenchConfig('session-123', 'pod-abc.example.com');
    expect(config.remoteAuthority).toBe('pod-abc.example.com');
  });

  it('should preserve port in remoteAuthority for local mode', () => {
    const config = adapter.getWorkbenchConfig('session-123', '127.0.0.1:8080');
    expect(config.remoteAuthority).toBe('127.0.0.1:8080');
    expect(config.wsUrl).toContain('127.0.0.1:8080');
  });

  it('should return wss WebSocket URL when page is https', () => {
    vi.stubGlobal('location', { protocol: 'https:' });

    const config = adapter.getWorkbenchConfig('session-123', 'pod-abc.example.com');
    expect(config.wsUrl).toBe('wss://pod-abc.example.com/reh/');
  });

  it('should return ws WebSocket URL when page is http', () => {
    vi.stubGlobal('location', { protocol: 'http:' });

    const config = adapter.getWorkbenchConfig('session-123', 'localhost');
    expect(config.wsUrl).toBe('ws://localhost/reh/');
  });

  it('should use wss when location is undefined (SSR)', () => {
    // globalThis.location is undefined in SSR/Node
    const originalLocation = globalThis.location;
    // @ts-expect-error - testing SSR scenario
    delete globalThis.location;

    const config = adapter.getWorkbenchConfig('session-123', 'pod.example.com');
    expect(config.wsUrl).toBe('wss://pod.example.com/reh/');

    globalThis.location = originalLocation;
  });

  it('should ignore sessionId in URL construction', () => {
    vi.stubGlobal('location', { protocol: 'https:' });

    const config1 = adapter.getWorkbenchConfig('aaa', 'host.example.com');
    const config2 = adapter.getWorkbenchConfig('bbb', 'host.example.com');

    // Same hostname → same URLs regardless of sessionId
    expect(config1.wsUrl).toBe(config2.wsUrl);
    expect(config1.remoteAuthority).toBe(config2.remoteAuthority);
  });
});
