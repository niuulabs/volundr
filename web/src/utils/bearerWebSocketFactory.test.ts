import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toBase64Url,
  buildSubprotocols,
  createBearerWebSocketFactory,
  VSCODE_REH_PROTOCOL,
  BEARER_PROTOCOL_PREFIX,
} from './bearerWebSocketFactory';

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  url: string;
  protocols: string | string[];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols ?? [];
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bearerWebSocketFactory', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- toBase64Url ----------------------------------------------------------

  describe('toBase64Url', () => {
    it('should encode a simple string', () => {
      const result = toBase64Url('hello');
      expect(result).toBe(btoa('hello').replace(/=+$/, ''));
    });

    it('should replace + with - and / with _', () => {
      // btoa('subjects?_d') contains + and / in standard base64
      const input = 'subjects?_d';
      const result = toBase64Url(input);
      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
      expect(result).not.toContain('=');
    });

    it('should strip padding characters', () => {
      // btoa('a') = 'YQ==' — has padding
      const result = toBase64Url('a');
      expect(result).toBe('YQ');
      expect(result).not.toContain('=');
    });

    it('should encode a JWT-like token', () => {
      const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
      const result = toBase64Url(token);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
      expect(result).not.toContain('=');
    });

    it('should handle empty string', () => {
      const result = toBase64Url('');
      expect(result).toBe('');
    });
  });

  // ---- buildSubprotocols ----------------------------------------------------

  describe('buildSubprotocols', () => {
    it('should return only REH protocol when token is null', () => {
      const protocols = buildSubprotocols(null);
      expect(protocols).toEqual([VSCODE_REH_PROTOCOL]);
    });

    it('should return REH protocol and bearer protocol when token is provided', () => {
      const token = 'my-jwt-token';
      const protocols = buildSubprotocols(token);

      expect(protocols).toHaveLength(2);
      expect(protocols[0]).toBe(VSCODE_REH_PROTOCOL);
      expect(protocols[1]).toMatch(
        new RegExp(`^${BEARER_PROTOCOL_PREFIX}\\.`)
      );
    });

    it('should base64url-encode the token in the bearer protocol', () => {
      const token = 'test-token-123';
      const protocols = buildSubprotocols(token);
      const bearerProtocol = protocols[1];
      const encoded = bearerProtocol.replace(`${BEARER_PROTOCOL_PREFIX}.`, '');

      expect(encoded).toBe(toBase64Url(token));
    });

    it('should return only REH protocol for empty string token', () => {
      // Empty string is falsy
      const protocols = buildSubprotocols('');
      expect(protocols).toEqual([VSCODE_REH_PROTOCOL]);
    });
  });

  // ---- createBearerWebSocketFactory -----------------------------------------

  describe('createBearerWebSocketFactory', () => {
    beforeEach(() => {
      vi.stubGlobal('WebSocket', MockWebSocket);
    });

    it('should create a WebSocket with subprotocol bearer auth', () => {
      const factory = createBearerWebSocketFactory({
        getToken: () => 'my-token',
      });

      const ws = factory('wss://example.com/reh/');

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(ws).toBe(MockWebSocket.instances[0]);

      const mock = MockWebSocket.instances[0];
      expect(mock.url).toBe('wss://example.com/reh/');
      expect(mock.protocols).toHaveLength(2);
      expect(mock.protocols[0]).toBe(VSCODE_REH_PROTOCOL);
      expect(mock.protocols[1]).toContain(BEARER_PROTOCOL_PREFIX);
    });

    it('should create a WebSocket without bearer when token is null', () => {
      const factory = createBearerWebSocketFactory({
        getToken: () => null,
      });

      factory('wss://example.com/reh/');

      const mock = MockWebSocket.instances[0];
      expect(mock.protocols).toEqual([VSCODE_REH_PROTOCOL]);
    });

    it('should call getToken on each invocation', () => {
      const getToken = vi.fn().mockReturnValueOnce('token-1').mockReturnValueOnce('token-2');

      const factory = createBearerWebSocketFactory({ getToken });

      factory('wss://example.com/a');
      factory('wss://example.com/b');

      expect(getToken).toHaveBeenCalledTimes(2);

      const mock1 = MockWebSocket.instances[0];
      const mock2 = MockWebSocket.instances[1];

      // Each should have a different encoded token
      expect(mock1.protocols[1]).toContain(toBase64Url('token-1'));
      expect(mock2.protocols[1]).toContain(toBase64Url('token-2'));
    });

    it('should pass the URL through unchanged', () => {
      const factory = createBearerWebSocketFactory({
        getToken: () => null,
      });

      const url = 'wss://my-session.example.com:8445/reh/?query=1';
      factory(url);

      expect(MockWebSocket.instances[0].url).toBe(url);
    });
  });
});
