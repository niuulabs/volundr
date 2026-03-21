import { describe, it, expect } from 'vitest';
import { MockEditorAdapter } from './editor.adapter';

describe('MockEditorAdapter', () => {
  it('should return predictable remoteAuthority', () => {
    const adapter = new MockEditorAdapter();
    const config = adapter.getWorkbenchConfig('session-1', 'test-host');

    expect(config.remoteAuthority).toBe('test-host');
  });

  it('should return wss WebSocket URL', () => {
    const adapter = new MockEditorAdapter();
    const config = adapter.getWorkbenchConfig('session-1', 'test-host');

    expect(config.wsUrl).toBe('wss://test-host/reh/');
  });

  it('should use hostname in URLs', () => {
    const adapter = new MockEditorAdapter();
    const config = adapter.getWorkbenchConfig('session-1', 'custom.example.com');

    expect(config.remoteAuthority).toContain('custom.example.com');
    expect(config.wsUrl).toContain('custom.example.com');
  });
});
