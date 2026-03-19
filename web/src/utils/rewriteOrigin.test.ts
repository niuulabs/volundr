import { describe, it, expect, afterEach } from 'vitest';
import { rewriteOrigin } from './rewriteOrigin';

describe('rewriteOrigin', () => {
  const originalLocation = globalThis.location;

  function mockLocation(overrides: Partial<Location>) {
    Object.defineProperty(globalThis, 'location', {
      value: {
        protocol: 'http:',
        hostname: 'localhost',
        host: 'localhost:5174',
        ...overrides,
      },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('rewrites loopback http URL to current origin', () => {
    mockLocation({ protocol: 'http:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('http://127.0.0.1:8080/api/session');
    expect(result).toBe('http://localhost:5174/api/session');
  });

  it('rewrites loopback ws URL to ws with current host', () => {
    mockLocation({ protocol: 'http:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('ws://127.0.0.1:8080/s/123/session');
    expect(result).toBe('ws://localhost:5174/s/123/session');
  });

  it('rewrites loopback wss URL to wss when page is https', () => {
    mockLocation({ protocol: 'https:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('wss://127.0.0.1:8080/s/123/session');
    expect(result).toBe('wss://localhost:5174/s/123/session');
  });

  it('rewrites ws to wss when page is https and host is loopback', () => {
    mockLocation({ protocol: 'https:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('ws://0.0.0.0:8080/s/123/session');
    expect(result).toBe('wss://localhost:5174/s/123/session');
  });

  it('rewrites same hostname different port', () => {
    mockLocation({ protocol: 'http:', hostname: 'myhost', host: 'myhost:5174' });
    const result = rewriteOrigin('http://myhost:8080/api/foo');
    expect(result).toBe('http://myhost:5174/api/foo');
  });

  it('does not rewrite different production hostname', () => {
    mockLocation({ protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com' });
    const result = rewriteOrigin('https://sessions.example.com/api/session');
    expect(result).toBe('https://sessions.example.com/api/session');
  });

  it('normalises ws to wss for non-rewritten production host on https page', () => {
    mockLocation({ protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com' });
    const result = rewriteOrigin('ws://sessions.example.com/s/123/session');
    expect(result).toBe('wss://sessions.example.com/s/123/session');
  });

  it('normalises wss to ws for non-rewritten production host on http page', () => {
    mockLocation({ protocol: 'http:', hostname: 'app.example.com', host: 'app.example.com' });
    const result = rewriteOrigin('wss://sessions.example.com/s/123/session');
    expect(result).toBe('ws://sessions.example.com/s/123/session');
  });

  it('leaves non-ws production URLs unchanged', () => {
    mockLocation({ protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com' });
    const result = rewriteOrigin('https://sessions.example.com/api/session');
    expect(result).toBe('https://sessions.example.com/api/session');
  });

  it('returns invalid URL strings as-is (catch branch)', () => {
    const result = rewriteOrigin('not a valid url');
    expect(result).toBe('not a valid url');
  });

  it('returns relative paths as-is', () => {
    const result = rewriteOrigin('/api/session');
    // URL constructor with no base throws for relative paths — catch branch
    expect(result).toBe('/api/session');
  });

  it('rewrites IPv6 loopback [::1]', () => {
    mockLocation({ protocol: 'http:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('http://[::1]:8080/api/session');
    expect(result).toBe('http://localhost:5174/api/session');
  });

  it('preserves query string and hash on rewrite', () => {
    mockLocation({ protocol: 'http:', hostname: 'localhost', host: 'localhost:5174' });
    const result = rewriteOrigin('http://127.0.0.1:8080/api?q=1#top');
    expect(result).toBe('http://localhost:5174/api?q=1#top');
  });
});
