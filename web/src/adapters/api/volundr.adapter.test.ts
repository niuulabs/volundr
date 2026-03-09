import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiVolundrService } from './volundr.adapter';
import { setTokenProvider } from './client';
import type {
  ApiSessionResponse,
  ApiModelInfo,
  SSESessionPayload,
  SSEStatsPayload,
  SSEMessagePayload,
  SSELogPayload,
  SSEChroniclePayload,
} from './volundr.types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Mock SSE stream that replaces EventSource-based tests.
 * When fetch is called with the SSE endpoint URL, it returns a ReadableStream
 * that the test can push SSE-formatted data into via simulateEvent/simulateError.
 */
class MockSSEStream {
  static instances: MockSSEStream[] = [];

  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private abortController: AbortController | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockSSEStream.instances.push(this);
  }

  /** Build the mock fetch Response with a ReadableStream body */
  createResponse(): Response {
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        this.controller = controller;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  /** Record the AbortController from the fetch call so we can detect aborts */
  setAbortController(ac: AbortController) {
    this.abortController = ac;
  }

  /** Push an SSE event into the stream and wait for processing */
  async simulateEvent(type: string, data: unknown) {
    if (!this.controller) return;
    const block = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    this.controller.enqueue(this.encoder.encode(block));
    // Yield to macrotask so the stream reader can process all microtasks
    await new Promise(r => setTimeout(r, 0));
  }

  /** Push a raw SSE block (for testing malformed data) */
  async simulateRawBlock(raw: string) {
    if (!this.controller) return;
    this.controller.enqueue(this.encoder.encode(raw));
    await new Promise(r => setTimeout(r, 0));
  }

  /** Simulate a stream error (causes the reader to reject) */
  simulateError() {
    if (!this.controller) return;
    this.controller.error(new Error('SSE connection error'));
    this.controller = null;
    const idx = MockSSEStream.instances.indexOf(this);
    if (idx !== -1) MockSSEStream.instances.splice(idx, 1);
  }

  /** Close the stream cleanly */
  close() {
    if (this.controller) {
      try {
        this.controller.close();
      } catch {
        // already closed
      }
      this.controller = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    const idx = MockSSEStream.instances.indexOf(this);
    if (idx !== -1) MockSSEStream.instances.splice(idx, 1);
  }
}

const SSE_URL = '/api/v1/volundr/sessions/stream';

/**
 * Wraps the global mockFetch so that SSE endpoint calls create a
 * MockSSEStream while all other calls fall through to the normal
 * vi.fn() mock (mockReturnValueOnce, etc.).
 */
function installSSEFetchMock() {
  const realImpl = global.fetch;
  global.fetch = ((url: string, init?: RequestInit) => {
    if (url === SSE_URL) {
      const stream = new MockSSEStream(url);
      const response = stream.createResponse();
      if (init?.signal) {
        init.signal.addEventListener('abort', () => stream.close());
      }
      return Promise.resolve(response);
    }
    // Delegate non-SSE calls to the vi.fn() mock
    return mockFetch(url, init);
  }) as typeof fetch;

  return () => {
    global.fetch = realImpl;
  };
}

describe('ApiVolundrService', () => {
  let service: ApiVolundrService;

  let cleanupSSEMock: () => void;

  beforeEach(() => {
    service = new ApiVolundrService();
    mockFetch.mockReset();
    MockSSEStream.instances = [];
    cleanupSSEMock = installSSEFetchMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Close any remaining SSE streams
    for (const stream of [...MockSSEStream.instances]) {
      stream.close();
    }
    cleanupSSEMock();
  });

  const mockApiSession: ApiSessionResponse = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Session',
    model: 'claude-sonnet-4-20250514',
    repo: 'odin/core',
    branch: 'main',
    status: 'running',
    chat_endpoint: 'http://localhost:8080/chat',
    code_endpoint: 'http://localhost:8080/code',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    last_active: '2024-01-15T10:30:00Z',
    message_count: 0,
    tokens_used: 0,
    pod_name: null,
    error: null,
  };

  const mockApiSessionWithExtras: ApiSessionResponse = {
    ...mockApiSession,
    message_count: 42,
    tokens_used: 15000,
    pod_name: 'volundr-abc123',
  };

  const mockApiModel: ApiModelInfo = {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance model',
    provider: 'cloud',
    tier: 'balanced',
    color: 'purple',
  };

  function mockResponse(data: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
    });
  }

  describe('getSessions', () => {
    it('returns transformed sessions from API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));

      const sessions = await service.getSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: mockApiSession.id,
        name: mockApiSession.name,
        model: mockApiSession.model,
        status: 'running',
      });
    });

    it('maps all required fields from API response', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));

      const sessions = await service.getSessions();

      expect(sessions[0].repo).toBe('odin/core');
      expect(sessions[0].branch).toBe('main');
      expect(sessions[0].messageCount).toBe(0);
      expect(sessions[0].tokensUsed).toBe(0);
    });

    it('extracts hostname from chat_endpoint for managed sessions', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));

      const sessions = await service.getSessions();

      expect(sessions[0].hostname).toBe('localhost:8080');
    });

    it('handles null endpoints gracefully', async () => {
      const sessionNoEndpoints = { ...mockApiSession, chat_endpoint: null, code_endpoint: null };
      mockFetch.mockReturnValueOnce(mockResponse([sessionNoEndpoints]));

      const sessions = await service.getSessions();

      expect(sessions[0].hostname).toBeUndefined();
    });

    it('uses API values when provided', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSessionWithExtras]));

      const sessions = await service.getSessions();

      expect(sessions[0].repo).toBe('odin/core');
      expect(sessions[0].branch).toBe('main');
      expect(sessions[0].messageCount).toBe(42);
      expect(sessions[0].tokensUsed).toBe(15000);
      expect(sessions[0].podName).toBe('volundr-abc123');
    });
  });

  describe('getSession', () => {
    it('returns transformed session by ID', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(mockApiSession));

      const session = await service.getSession(mockApiSession.id);

      expect(session).not.toBeNull();
      expect(session?.id).toBe(mockApiSession.id);
    });

    it('returns null for 404 response', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));

      const session = await service.getSession('nonexistent');

      expect(session).toBeNull();
    });
  });

  describe('getActiveSessions', () => {
    it('returns only running sessions', async () => {
      const stoppedSession: ApiSessionResponse = {
        ...mockApiSession,
        id: 'stopped-123',
        status: 'stopped',
      };
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession, stoppedSession]));

      const sessions = await service.getActiveSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('running');
    });
  });

  describe('getStats', () => {
    it('returns stats from API when available', async () => {
      const apiStats = {
        active_sessions: 3,
        total_sessions: 10,
        tokens_today: 50000,
        local_tokens: 20000,
        cloud_tokens: 30000,
        cost_today: 1.5,
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiStats));

      const stats = await service.getStats();

      expect(stats).toMatchObject({
        activeSessions: 3,
        totalSessions: 10,
        tokensToday: 50000,
        localTokens: 20000,
        cloudTokens: 30000,
        costToday: 1.5,
      });
    });

    it('computes stats from sessions when endpoint returns 404', async () => {
      // First call: /stats returns 404
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));
      // Second call: /sessions returns sessions
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));

      const stats = await service.getStats();

      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
    });
  });

  describe('getModels', () => {
    it('returns transformed models', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiModel]));

      const models = await service.getModels();

      expect(models['claude-sonnet-4-20250514']).toBeDefined();
      expect(models['claude-sonnet-4-20250514'].name).toBe('Claude Sonnet 4');
    });

    it('maps all required model metadata from API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiModel]));

      const models = await service.getModels();

      const model = models['claude-sonnet-4-20250514'];
      expect(model.provider).toBe('cloud');
      expect(model.tier).toBe('balanced');
      expect(model.color).toBe('purple');
    });

    it('uses API metadata when provided', async () => {
      const modelWithMetadata: ApiModelInfo = {
        ...mockApiModel,
        provider: 'cloud',
        tier: 'frontier',
        color: 'gold',
      };
      mockFetch.mockReturnValueOnce(mockResponse([modelWithMetadata]));

      const models = await service.getModels();

      const model = models['claude-sonnet-4-20250514'];
      expect(model.tier).toBe('frontier');
      expect(model.color).toBe('gold');
    });
  });

  describe('status mapping', () => {
    it('maps "failed" to "error"', async () => {
      const failedSession: ApiSessionResponse = {
        ...mockApiSession,
        status: 'failed',
        error: 'Pod crashed',
      };
      mockFetch.mockReturnValueOnce(mockResponse([failedSession]));

      const sessions = await service.getSessions();

      expect(sessions[0].status).toBe('error');
      expect(sessions[0].error).toBe('Pod crashed');
    });

    it('preserves other statuses', async () => {
      const statuses: Array<{
        api: 'created' | 'starting' | 'running' | 'stopping' | 'stopped';
        expected: string;
      }> = [
        { api: 'created', expected: 'created' },
        { api: 'starting', expected: 'starting' },
        { api: 'running', expected: 'running' },
        { api: 'stopping', expected: 'stopping' },
        { api: 'stopped', expected: 'stopped' },
      ];

      for (const { api, expected } of statuses) {
        mockFetch.mockReturnValueOnce(mockResponse([{ ...mockApiSession, status: api }]));
        const sessions = await service.getSessions();
        expect(sessions[0].status).toBe(expected);
      }
    });
  });

  describe('startSession', () => {
    it('creates a session (backend auto-starts)', async () => {
      // Single call: POST /sessions (backend creates AND starts)
      mockFetch.mockReturnValueOnce(mockResponse(mockApiSession, 201));

      const session = await service.startSession({
        name: 'Test',
        repo: 'odin/core',
        branch: 'main',
        model: 'claude-sonnet-4-20250514',
      });

      expect(session).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify create request body
      const createCall = mockFetch.mock.calls[0];
      const createBody = JSON.parse(createCall[1].body);
      expect(createBody.name).toBe('Test');
      expect(createBody.model).toBe('claude-sonnet-4-20250514');
      expect(createBody.repo).toBe('odin/core');
      expect(createBody.branch).toBe('main');
    });
  });

  describe('stopSession', () => {
    it('calls stop endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(mockApiSession));

      await service.stopSession(mockApiSession.id);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/sessions/${mockApiSession.id}/stop`),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('resumeSession', () => {
    it('calls start endpoint', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(mockApiSession));

      await service.resumeSession(mockApiSession.id);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/sessions/${mockApiSession.id}/start`),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('opens SSE connection on first subscriber', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      // Wait for async connection
      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      expect(MockSSEStream.instances[0].url).toBe('/api/v1/volundr/sessions/stream');
    });

    it('closes SSE connection when last subscriber unsubscribes', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsubscribe();
      expect(MockSSEStream.instances).toHaveLength(0);
    });

    it('does not duplicate SSE connections for multiple subscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });
    });
  });

  describe('SSE events', () => {
    const mockSSESession: SSESessionPayload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'SSE Test Session',
      model: 'claude-sonnet-4-20250514',
      repo: 'https://github.com/org/repo',
      branch: 'main',
      status: 'running',
      chat_endpoint: 'https://session-abc.volundr.example.com/chat',
      code_endpoint: 'https://session-abc.volundr.example.com/code',
      created_at: '2026-02-03T12:00:00',
      updated_at: '2026-02-03T12:05:00',
      last_active: '2026-02-03T12:05:00',
      message_count: 5,
      tokens_used: 1500,
      pod_name: 'volundr-abc123',
      error: null,
    };

    it('handles session_created events', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];
      await eventSource.simulateEvent('session_created', mockSSESession);

      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: mockSSESession.id,
            name: mockSSESession.name,
            status: 'running',
            hostname: 'session-abc.volundr.example.com',
          }),
        ])
      );
    });

    it('handles session_updated events', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];

      // First create the session
      await eventSource.simulateEvent('session_created', mockSSESession);

      // Then update it
      const updatedSession = { ...mockSSESession, status: 'stopped' as const, tokens_used: 2000 };
      await eventSource.simulateEvent('session_updated', updatedSession);

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall[0].status).toBe('stopped');
      expect(lastCall[0].tokensUsed).toBe(2000);
    });

    it('handles session_deleted events', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];

      // First create the session
      await eventSource.simulateEvent('session_created', mockSSESession);
      expect(callback.mock.calls[callback.mock.calls.length - 1][0]).toHaveLength(1);

      // Then delete it
      await eventSource.simulateEvent('session_deleted', { id: mockSSESession.id });

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall).toHaveLength(0);
    });

    it('handles stats_updated events', async () => {
      const statsCallback = vi.fn();
      service.subscribeStats(statsCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockStats: SSEStatsPayload = {
        active_sessions: 3,
        total_sessions: 10,
        tokens_today: 50000,
        local_tokens: 10000,
        cloud_tokens: 40000,
        cost_today: 2.5,
      };

      const eventSource = MockSSEStream.instances[0];
      await eventSource.simulateEvent('stats_updated', mockStats);

      expect(statsCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          activeSessions: 3,
          totalSessions: 10,
          tokensToday: 50000,
          localTokens: 10000,
          cloudTokens: 40000,
          costToday: 2.5,
        })
      );
    });

    it('maps failed status to error', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const failedSession = {
        ...mockSSESession,
        status: 'failed' as const,
        error: 'Pod OOMKilled',
      };
      const eventSource = MockSSEStream.instances[0];
      await eventSource.simulateEvent('session_created', failedSession);

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall[0].status).toBe('error');
      expect(lastCall[0].error).toBe('Pod OOMKilled');
    });
  });

  describe('SSE reconnection', () => {
    it('schedules reconnect on connection error', async () => {
      vi.useFakeTimers();

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];
      eventSource.simulateError();

      // Connection should be closed
      expect(MockSSEStream.instances).toHaveLength(0);

      // Fast-forward past reconnection delay
      await vi.advanceTimersByTimeAsync(1000);

      // Should have reconnected
      expect(MockSSEStream.instances).toHaveLength(1);

      vi.useRealTimers();
    });

    it('does not reconnect when all subscribers have unsubscribed', async () => {
      vi.useFakeTimers();

      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];

      // Unsubscribe before error
      unsubscribe();

      // Simulate error - should not schedule reconnect since no subscribers
      eventSource.simulateError();

      // Fast-forward past reconnection delay
      await vi.advanceTimersByTimeAsync(1000);

      // Should NOT have reconnected since there are no subscribers
      expect(MockSSEStream.instances).toHaveLength(0);

      vi.useRealTimers();
    });

    it('clears pending reconnect timeout when unsubscribing', async () => {
      vi.useFakeTimers();

      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];

      // Trigger error to schedule reconnect
      eventSource.simulateError();

      // Connection closed, reconnect scheduled
      expect(MockSSEStream.instances).toHaveLength(0);

      // Unsubscribe while reconnect is pending - should clear the timeout
      unsubscribe();

      // Fast-forward past reconnection delay
      await vi.advanceTimersByTimeAsync(2000);

      // Should NOT have reconnected since we unsubscribed
      expect(MockSSEStream.instances).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('subscribeStats', () => {
    it('does not notify when cachedStats is null', async () => {
      // Create a new service instance (cachedStats will be null)
      const freshService = new ApiVolundrService();
      const statsCallback = vi.fn();

      // Subscribe to stats - should NOT call callback since no cached stats
      freshService.subscribeStats(statsCallback);

      // The callback should not have been called with stats (only connection events)
      // Wait a tick to ensure any async operations complete
      await vi.waitFor(() => {
        expect(MockSSEStream.instances.length).toBeGreaterThan(0);
      });

      // Stats callback should not be called since cachedStats is null
      expect(statsCallback).not.toHaveBeenCalled();
    });

    it('notifies immediately with cached stats when available', async () => {
      const statsCallback = vi.fn();

      // First, populate the cache by receiving a stats_updated event
      service.subscribeStats(statsCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockStats: SSEStatsPayload = {
        active_sessions: 5,
        total_sessions: 20,
        tokens_today: 100000,
        local_tokens: 50000,
        cloud_tokens: 50000,
        cost_today: 5.0,
      };

      const eventSource = MockSSEStream.instances[0];
      await eventSource.simulateEvent('stats_updated', mockStats);

      // First callback from SSE event
      expect(statsCallback).toHaveBeenCalledTimes(1);

      // Now subscribe a second callback - should receive cached stats immediately
      const secondCallback = vi.fn();
      service.subscribeStats(secondCallback);

      expect(secondCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          activeSessions: 5,
          totalSessions: 20,
        })
      );
    });
  });

  describe('connectSession', () => {
    it('creates a manual session locally without API call', async () => {
      const session = await service.connectSession({
        name: 'my-skuld',
        hostname: 'skuld-01.local',
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(session.name).toBe('my-skuld');
      expect(session.hostname).toBe('skuld-01.local');
      expect(session.source).toBe('manual');
      expect(session.status).toBe('starting');
      expect(session.id).toMatch(/^manual-/);
    });

    it('adds manual session to cached sessions', async () => {
      // First populate cache
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));
      await service.getSessions();
      mockFetch.mockReset();

      const session = await service.connectSession({
        name: 'test',
        hostname: 'host',
      });

      // Verify it shows up in cached sessions via subscriber
      const callback = vi.fn();
      service.subscribe(callback);

      // The session was already added, so subscriber won't be called retroactively
      // But we can verify by connecting another to trigger notification
      expect(session.source).toBe('manual');
    });

    it('notifies session subscribers', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await service.connectSession({ name: 'test', hostname: 'host' });

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('manual session lifecycle', () => {
    it('stops manual session without API call', async () => {
      const session = await service.connectSession({
        name: 'test',
        hostname: 'host',
      });
      mockFetch.mockReset();

      await service.stopSession(session.id);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resumes manual session without API call', async () => {
      const session = await service.connectSession({
        name: 'test',
        hostname: 'host',
      });
      await service.stopSession(session.id);
      mockFetch.mockReset();

      await service.resumeSession(session.id);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('deletes manual session without API call', async () => {
      const session = await service.connectSession({
        name: 'test',
        hostname: 'host',
      });
      mockFetch.mockReset();

      await service.deleteSession(session.id);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getCodeServerUrl', () => {
    it('returns null for starting manual session', async () => {
      const session = await service.connectSession({
        name: 'test',
        hostname: 'skuld-dev.local',
      });

      // Manual sessions start as 'starting' — code server isn't ready yet
      const url = await service.getCodeServerUrl(session.id);

      expect(url).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for stopped manual session', async () => {
      const session = await service.connectSession({
        name: 'test',
        hostname: 'skuld-dev.local',
      });
      await service.stopSession(session.id);

      const url = await service.getCodeServerUrl(session.id);

      expect(url).toBeNull();
    });

    it('calls API for managed sessions', async () => {
      // Populate cache with a managed session
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));
      const sessions = await service.getSessions();

      mockFetch.mockReturnValueOnce(mockResponse(mockApiSession));
      const url = await service.getCodeServerUrl(sessions[0].id);

      expect(url).toBe(mockApiSession.code_endpoint);
    });

    it('returns null for stopped managed session', async () => {
      const stoppedSession = { ...mockApiSession, status: 'stopped' };
      mockFetch.mockReturnValueOnce(mockResponse(stoppedSession));

      const url = await service.getCodeServerUrl(mockApiSession.id);

      expect(url).toBeNull();
    });

    it('returns null for 404 managed session', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));

      const url = await service.getCodeServerUrl('nonexistent-managed');

      expect(url).toBeNull();
    });

    it('throws for other API errors', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Server error' }, 500));

      await expect(service.getCodeServerUrl('some-id')).rejects.toThrow();
    });
  });

  describe('SSE message and log events', () => {
    const mockSSESession: SSESessionPayload = {
      id: 'session-for-msgs',
      name: 'Msg Test',
      model: 'claude-sonnet-4-20250514',
      repo: 'org/repo',
      branch: 'main',
      status: 'running',
      chat_endpoint: null,
      code_endpoint: null,
      created_at: '2026-02-03T12:00:00',
      updated_at: '2026-02-03T12:05:00',
      last_active: '2026-02-03T12:05:00',
      message_count: 0,
      tokens_used: 0,
      pod_name: null,
      error: null,
    };

    it('handles message_received events and notifies subscribers', async () => {
      const msgCallback = vi.fn();
      service.subscribeMessages('session-for-msgs', msgCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockMessage: SSEMessagePayload = {
        id: 'msg-001',
        session_id: 'session-for-msgs',
        role: 'assistant',
        content: 'Hello from SSE',
        created_at: '2026-02-03T12:10:00',
        tokens_in: 10,
        tokens_out: 50,
        latency_ms: 200,
      };

      await MockSSEStream.instances[0].simulateEvent('message_received', mockMessage);

      expect(msgCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-001',
          sessionId: 'session-for-msgs',
          role: 'assistant',
          content: 'Hello from SSE',
        })
      );
    });

    it('handles log_received events and notifies subscribers', async () => {
      const logCallback = vi.fn();
      service.subscribeLogs('session-for-logs', logCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockLog: SSELogPayload = {
        id: 'log-001',
        session_id: 'session-for-logs',
        timestamp: '2026-02-03T12:10:00',
        level: 'info',
        source: 'broker',
        message: 'Session started',
      };

      await MockSSEStream.instances[0].simulateEvent('log_received', mockLog);

      expect(logCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'log-001',
          sessionId: 'session-for-logs',
          level: 'info',
          message: 'Session started',
        })
      );
    });

    it('does not notify message subscribers for different session', async () => {
      const msgCallback = vi.fn();
      service.subscribeMessages('other-session', msgCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockMessage: SSEMessagePayload = {
        id: 'msg-002',
        session_id: 'different-session',
        role: 'user',
        content: 'Test',
        created_at: '2026-02-03T12:10:00',
      };

      await MockSSEStream.instances[0].simulateEvent('message_received', mockMessage);

      expect(msgCallback).not.toHaveBeenCalled();
    });

    it('handles SSE parse errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const stream = MockSSEStream.instances[0];
      // Send raw invalid JSON through the stream
      await stream.simulateRawBlock('event: session_created\ndata: not valid json{{{\n\n');

      // Should not crash, just log error
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles session_updated for unknown session', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const eventSource = MockSSEStream.instances[0];

      // Update a session that's not in the cache - should add it
      const unknownSession: SSESessionPayload = {
        ...mockSSESession,
        id: 'unknown-session',
        name: 'Unknown',
      };
      await eventSource.simulateEvent('session_updated', unknownSession);

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'unknown-session' })])
      );
    });
  });

  describe('subscribeMessages', () => {
    it('returns unsubscribe function', () => {
      const unsubscribe = service.subscribeMessages('session-id', vi.fn());
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('cleans up empty subscriber sets on unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribeMessages('session-id', callback);
      unsubscribe();
      // Should not throw when unsubscribing
    });

    it('starts SSE if no other subscribers exist', async () => {
      const freshService = new ApiVolundrService();
      const callback = vi.fn();

      freshService.subscribeMessages('session-id', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances.length).toBeGreaterThan(0);
      });
    });
  });

  describe('subscribeLogs', () => {
    it('returns unsubscribe function', () => {
      const unsubscribe = service.subscribeLogs('session-id', vi.fn());
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('starts SSE if no other subscribers exist', async () => {
      const freshService = new ApiVolundrService();
      const callback = vi.fn();

      freshService.subscribeLogs('session-id', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances.length).toBeGreaterThan(0);
      });
    });

    it('cleans up empty subscriber sets on unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribeLogs('session-id', callback);
      unsubscribe();
    });
  });

  describe('subscribe with cached sessions', () => {
    it('notifies immediately with cached sessions when available', async () => {
      // Populate cache first
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));
      await service.getSessions();

      const callback = vi.fn();
      service.subscribe(callback);

      // Should be called immediately with cached data
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: mockApiSession.id })])
      );
    });
  });

  describe('stopSession with cached session', () => {
    it('updates cached session status when stopping managed session', async () => {
      // Populate cache
      mockFetch.mockReturnValueOnce(mockResponse([mockApiSession]));
      await service.getSessions();

      const callback = vi.fn();
      service.subscribe(callback);

      mockFetch.mockReturnValueOnce(mockResponse({}));
      await service.stopSession(mockApiSession.id);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('resumeSession with cached session', () => {
    it('updates cached session status when resuming managed session', async () => {
      // Populate cache with a stopped session
      const stoppedSession = { ...mockApiSession, status: 'stopped' as const };
      mockFetch.mockReturnValueOnce(mockResponse([stoppedSession]));
      await service.getSessions();

      const callback = vi.fn();
      service.subscribe(callback);

      mockFetch.mockReturnValueOnce(mockResponse({}));
      await service.resumeSession(mockApiSession.id);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('model transforms', () => {
    it('uses default cost for known models when API omits it', async () => {
      const modelWithoutCost: ApiModelInfo = {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        description: 'Frontier model',
        provider: 'cloud',
        tier: 'frontier',
        color: 'purple',
      };
      mockFetch.mockReturnValueOnce(mockResponse([modelWithoutCost]));

      const models = await service.getModels();
      expect(models['claude-opus-4-20250514'].cost).toBe('$15/M');
    });

    it('uses API cost when provided', async () => {
      const modelWithCost: ApiModelInfo = {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        description: 'Frontier model',
        provider: 'cloud',
        tier: 'frontier',
        color: 'purple',
        cost_per_million_tokens: 20,
      };
      mockFetch.mockReturnValueOnce(mockResponse([modelWithCost]));

      const models = await service.getModels();
      expect(models['claude-opus-4-20250514'].cost).toBe('$20/M');
    });

    it('uses default vram for known local models', async () => {
      const localModel: ApiModelInfo = {
        id: 'qwen2.5-coder:32b',
        name: 'Qwen 2.5 Coder',
        description: 'Local coder model',
        provider: 'local',
        tier: 'execution',
        color: 'cyan',
      };
      mockFetch.mockReturnValueOnce(mockResponse([localModel]));

      const models = await service.getModels();
      expect(models['qwen2.5-coder:32b'].vram).toBe('24GB');
    });
  });

  describe('subscribeChronicle', () => {
    it('returns unsubscribe function', () => {
      const unsubscribe = service.subscribeChronicle('session-id', vi.fn());
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('starts SSE if no other subscribers exist', async () => {
      const freshService = new ApiVolundrService();
      const callback = vi.fn();

      freshService.subscribeChronicle('session-id', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances.length).toBeGreaterThan(0);
      });
    });

    it('does not start duplicate SSE when already connected', async () => {
      const callback1 = vi.fn();
      service.subscribe(callback1);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Subscribe chronicle when SSE is already connected
      const callback2 = vi.fn();
      service.subscribeChronicle('session-id', callback2);

      // Still only one SSE connection
      expect(MockSSEStream.instances).toHaveLength(1);
    });

    it('reuses subscriber set when multiple subscribers for same session', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      service.subscribeChronicle('session-id', callback1);
      service.subscribeChronicle('session-id', callback2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Both should receive events
      const payload = {
        session_id: 'session-id',
        event: { t: 1, type: 'session', label: 'Started' },
        files: [],
        commits: [],
        token_burn: [1],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('keeps subscriber set when one of multiple subscribers unsubscribes', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = service.subscribeChronicle('session-id', callback1);
      service.subscribeChronicle('session-id', callback2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsub1();

      // Second subscriber should still receive events
      const payload = {
        session_id: 'session-id',
        event: { t: 2, type: 'session', label: 'Progressing' },
        files: [],
        commits: [],
        token_burn: [1, 2],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('cleans up empty subscriber sets on unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribeChronicle('session-id', callback);
      unsubscribe();
      // Should not throw when unsubscribing
    });
  });

  describe('SSE chronicle events', () => {
    it('handles chronicle_event and notifies subscribers', async () => {
      const callback = vi.fn();
      service.subscribeChronicle('session-abc', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const payload: SSEChroniclePayload = {
        session_id: 'session-abc',
        event: {
          t: 42,
          type: 'file',
          label: 'src/main.ts',
          action: 'modified',
          ins: 10,
          del: 3,
        },
        files: [{ path: 'src/main.ts', status: 'mod', ins: 10, del: 3 }],
        commits: [],
        token_burn: [1, 2, 3],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              t: 42,
              type: 'file',
              label: 'src/main.ts',
              action: 'modified',
              ins: 10,
              del: 3,
            }),
          ],
          files: [expect.objectContaining({ path: 'src/main.ts', status: 'mod' })],
          commits: [],
          tokenBurn: [1, 2, 3],
        })
      );
    });

    it('does not notify chronicle subscribers for different session', async () => {
      const callback = vi.fn();
      service.subscribeChronicle('session-other', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const payload: SSEChroniclePayload = {
        session_id: 'session-different',
        event: {
          t: 10,
          type: 'message',
          label: 'User prompt',
          tokens: 100,
        },
        files: [],
        commits: [],
        token_burn: [1],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles chronicle_event with null event gracefully', async () => {
      const callback = vi.fn();
      service.subscribeChronicle('session-abc', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Simulate payload with null event
      const payload = {
        session_id: 'session-abc',
        event: null,
        files: [{ path: 'src/main.ts', status: 'mod', ins: 5, del: 0 }],
        commits: [],
        token_burn: [1, 2],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [],
          files: [expect.objectContaining({ path: 'src/main.ts' })],
        })
      );
    });

    it('handles chronicle_event parse errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callback = vi.fn();
      service.subscribeChronicle('session-abc', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const stream = MockSSEStream.instances[0];
      // Send raw invalid JSON through the stream
      await stream.simulateRawBlock('event: chronicle_event\ndata: invalid json!!!\n\n');

      // Allow microtask to process
      await new Promise(r => setTimeout(r, 10));

      expect(callback).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles chronicle_event with commit data', async () => {
      const callback = vi.fn();
      service.subscribeChronicle('session-abc', callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const payload: SSEChroniclePayload = {
        session_id: 'session-abc',
        event: {
          t: 120,
          type: 'git',
          label: 'fix: resolve null pointer',
          hash: 'abc1234',
          ins: 5,
          del: 2,
        },
        files: [{ path: 'src/main.ts', status: 'mod', ins: 5, del: 2 }],
        commits: [{ hash: 'abc1234', msg: 'fix: resolve null pointer', time: '2m ago' }],
        token_burn: [1, 2, 3, 4],
      };

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', payload);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [expect.objectContaining({ type: 'git', hash: 'abc1234' })],
          commits: [expect.objectContaining({ hash: 'abc1234' })],
          tokenBurn: [1, 2, 3, 4],
        })
      );
    });
  });

  describe('getChronicle', () => {
    it('returns transformed chronicle from API', async () => {
      const apiChronicle = {
        events: [{ t: 0, type: 'session', label: 'Session started' }],
        files: [{ path: 'src/app.ts', status: 'new', ins: 50, del: 0 }],
        commits: [{ hash: 'def5678', msg: 'feat: initial', time: '1m ago' }],
        token_burn: [5, 10, 15],
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiChronicle));

      const chronicle = await service.getChronicle('session-123');

      expect(chronicle).toMatchObject({
        events: [expect.objectContaining({ t: 0, type: 'session', label: 'Session started' })],
        files: [expect.objectContaining({ path: 'src/app.ts', status: 'new', ins: 50 })],
        commits: [expect.objectContaining({ hash: 'def5678' })],
        tokenBurn: [5, 10, 15],
      });
    });

    it('returns null for 404 response', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));

      const chronicle = await service.getChronicle('nonexistent');

      expect(chronicle).toBeNull();
    });

    it('throws for non-404 errors', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Server error' }, 500));

      await expect(service.getChronicle('some-id')).rejects.toThrow();
    });

    it('transforms optional chronicle event fields', async () => {
      const apiChronicle = {
        events: [
          { t: 10, type: 'file', label: 'src/a.ts', action: 'created', ins: 20, del: null },
          { t: 20, type: 'terminal', label: 'npm test', exit: 0, tokens: null },
          { t: 30, type: 'git', label: 'commit', hash: 'abc123', ins: 5, del: 3 },
        ],
        files: [],
        commits: [],
        token_burn: [],
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiChronicle));

      const chronicle = await service.getChronicle('session-456');

      expect(chronicle!.events[0]).toMatchObject({ action: 'created', ins: 20 });
      expect(chronicle!.events[0]).not.toHaveProperty('del');
      expect(chronicle!.events[1]).toMatchObject({ exit: 0 });
      expect(chronicle!.events[1]).not.toHaveProperty('tokens');
      expect(chronicle!.events[2]).toMatchObject({ hash: 'abc123' });
    });
  });

  describe('subscribe SSE lifecycle edge cases', () => {
    it('does not disconnect SSE when stats subscribers remain after session unsub', async () => {
      const sessionCallback = vi.fn();
      const statsCallback = vi.fn();

      service.subscribeStats(statsCallback);
      const unsubSession = service.subscribe(sessionCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Unsubscribe sessions but stats still active
      unsubSession();
      expect(MockSSEStream.instances).toHaveLength(1); // SSE stays open
    });

    it('disconnects SSE when last stats subscriber unsubscribes', async () => {
      const statsCallback = vi.fn();
      const unsubStats = service.subscribeStats(statsCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsubStats();
      expect(MockSSEStream.instances).toHaveLength(0);
    });

    it('does not disconnect SSE when session subscribers remain after stats unsub', async () => {
      const sessionCallback = vi.fn();
      const statsCallback = vi.fn();

      service.subscribe(sessionCallback);
      const unsubStats = service.subscribeStats(statsCallback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsubStats();
      expect(MockSSEStream.instances).toHaveLength(1); // SSE stays open
    });
  });

  describe('subscribeMessages edge cases', () => {
    it('reuses subscriber set for same session', async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      service.subscribeMessages('s1', cb1);
      service.subscribeMessages('s1', cb2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockMessage: SSEMessagePayload = {
        id: 'msg-x',
        session_id: 's1',
        role: 'assistant',
        content: 'Hi',
        created_at: '2026-02-03T12:00:00',
      };
      await MockSSEStream.instances[0].simulateEvent('message_received', mockMessage);

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it('keeps subscriber set when one of multiple unsubscribes', async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const unsub1 = service.subscribeMessages('s1', cb1);
      service.subscribeMessages('s1', cb2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsub1();

      const mockMessage: SSEMessagePayload = {
        id: 'msg-y',
        session_id: 's1',
        role: 'assistant',
        content: 'Still here',
        created_at: '2026-02-03T12:00:00',
      };
      await MockSSEStream.instances[0].simulateEvent('message_received', mockMessage);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });
  });

  describe('subscribeLogs edge cases', () => {
    it('reuses subscriber set for same session', async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      service.subscribeLogs('s1', cb1);
      service.subscribeLogs('s1', cb2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      const mockLog: SSELogPayload = {
        id: 'log-x',
        session_id: 's1',
        timestamp: '2026-02-03T12:00:00',
        level: 'info',
        source: 'test',
        message: 'Hello',
      };
      await MockSSEStream.instances[0].simulateEvent('log_received', mockLog);

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it('keeps subscriber set when one of multiple unsubscribes', async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const unsub1 = service.subscribeLogs('s1', cb1);
      service.subscribeLogs('s1', cb2);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      unsub1();

      const mockLog: SSELogPayload = {
        id: 'log-y',
        session_id: 's1',
        timestamp: '2026-02-03T12:00:00',
        level: 'info',
        source: 'test',
        message: 'Still logging',
      };
      await MockSSEStream.instances[0].simulateEvent('log_received', mockLog);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });
  });

  describe('model transforms edge cases', () => {
    it('uses empty defaults for unknown model', async () => {
      const unknownModel: ApiModelInfo = {
        id: 'unknown-model-xyz',
        name: 'Unknown Model',
        description: 'No defaults',
        provider: 'local',
        tier: 'execution',
        color: 'gray',
      };
      mockFetch.mockReturnValueOnce(mockResponse([unknownModel]));

      const models = await service.getModels();

      expect(models['unknown-model-xyz']).toBeDefined();
      expect(models['unknown-model-xyz'].cost).toBeUndefined();
      expect(models['unknown-model-xyz'].vram).toBeUndefined();
    });
  });

  describe('getSession error handling', () => {
    it('throws for non-404 errors', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Server error' }, 500));

      await expect(service.getSession('some-id')).rejects.toThrow();
    });
  });

  describe('getStats error handling', () => {
    it('throws for non-404 errors', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Server error' }, 500));

      await expect(service.getStats()).rejects.toThrow();
    });
  });

  describe('getPullRequests', () => {
    const mockApiPR: import('./volundr.types').ApiPullRequestResponse = {
      number: 42,
      title: 'Add login feature',
      url: 'https://github.com/org/repo/pull/42',
      repo_url: 'https://github.com/org/repo',
      provider: 'github',
      source_branch: 'feature/login',
      target_branch: 'main',
      status: 'open',
      description: 'A new login feature',
      ci_status: 'passed',
      review_status: 'approved',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    it('returns transformed pull requests', async () => {
      mockFetch.mockReturnValueOnce(mockResponse([mockApiPR]));

      const prs = await service.getPullRequests('https://github.com/org/repo', 'open');

      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        number: 42,
        title: 'Add login feature',
        url: 'https://github.com/org/repo/pull/42',
        repoUrl: 'https://github.com/org/repo',
        provider: 'github',
        sourceBranch: 'feature/login',
        targetBranch: 'main',
        status: 'open',
        description: 'A new login feature',
        ciStatus: 'passed',
        reviewStatus: 'approved',
      });
    });

    it('maps unknown status to open', async () => {
      const prWithBadStatus = { ...mockApiPR, status: 'bizarre' };
      mockFetch.mockReturnValueOnce(mockResponse([prWithBadStatus]));

      const prs = await service.getPullRequests('https://github.com/org/repo');

      expect(prs[0].status).toBe('open');
    });

    it('handles null optional fields', async () => {
      const prNulls = {
        ...mockApiPR,
        description: null,
        ci_status: null,
        review_status: null,
        created_at: null,
        updated_at: null,
      };
      mockFetch.mockReturnValueOnce(mockResponse([prNulls]));

      const prs = await service.getPullRequests('https://github.com/org/repo');

      expect(prs[0].description).toBeUndefined();
      expect(prs[0].ciStatus).toBeUndefined();
      expect(prs[0].reviewStatus).toBeUndefined();
    });

    it('maps merged and closed statuses', async () => {
      const mergedPR = { ...mockApiPR, status: 'merged' };
      const closedPR = { ...mockApiPR, number: 43, status: 'closed' };
      mockFetch.mockReturnValueOnce(mockResponse([mergedPR, closedPR]));

      const prs = await service.getPullRequests('https://github.com/org/repo', 'all');

      expect(prs[0].status).toBe('merged');
      expect(prs[1].status).toBe('closed');
    });

    it('maps unknown CI status to unknown', async () => {
      const prWithBadCI = { ...mockApiPR, ci_status: 'weird_status' };
      mockFetch.mockReturnValueOnce(mockResponse([prWithBadCI]));

      const prs = await service.getPullRequests('https://github.com/org/repo');

      expect(prs[0].ciStatus).toBe('unknown');
    });
  });

  describe('createPullRequest', () => {
    it('creates a pull request and returns transformed result', async () => {
      const apiResponse: import('./volundr.types').ApiPullRequestResponse = {
        number: 99,
        title: 'New Feature',
        url: 'https://github.com/org/repo/pull/99',
        repo_url: 'https://github.com/org/repo',
        provider: 'github',
        source_branch: 'feature/new',
        target_branch: 'main',
        status: 'open',
        ci_status: 'pending',
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse, 201));

      const pr = await service.createPullRequest('session-123', 'New Feature', 'main');

      expect(pr.number).toBe(99);
      expect(pr.title).toBe('New Feature');
      expect(pr.status).toBe('open');
      expect(pr.ciStatus).toBe('pending');
    });

    it('sends correct request body', async () => {
      const apiResponse: import('./volundr.types').ApiPullRequestResponse = {
        number: 100,
        title: 'PR Title',
        url: 'https://github.com/org/repo/pull/100',
        repo_url: 'https://github.com/org/repo',
        provider: 'github',
        source_branch: 'feat',
        target_branch: 'develop',
        status: 'open',
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse, 201));

      await service.createPullRequest('session-456', 'PR Title', 'develop');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.session_id).toBe('session-456');
      expect(callBody.title).toBe('PR Title');
      expect(callBody.target_branch).toBe('develop');
    });
  });

  describe('mergePullRequest', () => {
    it('returns merge result', async () => {
      const apiResponse: import('./volundr.types').ApiMergeResultResponse = { merged: true };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const result = await service.mergePullRequest(42, 'https://github.com/org/repo');

      expect(result.merged).toBe(true);
    });

    it('sends merge method in request body', async () => {
      const apiResponse: import('./volundr.types').ApiMergeResultResponse = { merged: true };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      await service.mergePullRequest(42, 'https://github.com/org/repo', 'rebase');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.merge_method).toBe('rebase');
    });

    it('returns false when merge fails', async () => {
      const apiResponse: import('./volundr.types').ApiMergeResultResponse = { merged: false };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const result = await service.mergePullRequest(42, 'https://github.com/org/repo');

      expect(result.merged).toBe(false);
    });
  });

  describe('getCIStatus', () => {
    it('returns CI status for a PR', async () => {
      const apiResponse: import('./volundr.types').ApiCIStatusResponse = { status: 'passed' };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const status = await service.getCIStatus(42, 'https://github.com/org/repo', 'feature/login');

      expect(status).toBe('passed');
    });

    it('maps unknown CI status to unknown', async () => {
      const apiResponse: import('./volundr.types').ApiCIStatusResponse = {
        status: 'exotic_status',
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const status = await service.getCIStatus(42, 'https://github.com/org/repo', 'main');

      expect(status).toBe('unknown');
    });

    it('returns running CI status', async () => {
      const apiResponse: import('./volundr.types').ApiCIStatusResponse = { status: 'running' };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const status = await service.getCIStatus(42, 'https://github.com/org/repo', 'main');

      expect(status).toBe('running');
    });

    it('returns pending CI status', async () => {
      const apiResponse: import('./volundr.types').ApiCIStatusResponse = { status: 'pending' };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const status = await service.getCIStatus(42, 'https://github.com/org/repo', 'main');

      expect(status).toBe('pending');
    });

    it('returns failed CI status', async () => {
      const apiResponse: import('./volundr.types').ApiCIStatusResponse = { status: 'failed' };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const status = await service.getCIStatus(42, 'https://github.com/org/repo', 'main');

      expect(status).toBe('failed');
    });
  });

  describe('getIdentity', () => {
    it('returns transformed identity from API', async () => {
      const apiResponse: import('./volundr.types').ApiIdentityResponse = {
        user_id: 'u1',
        email: 'user@test.com',
        tenant_id: 't1',
        roles: ['volundr:admin'],
        display_name: 'Test User',
        status: 'active',
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const identity = await service.getIdentity();

      expect(identity).toMatchObject({
        userId: 'u1',
        email: 'user@test.com',
        tenantId: 't1',
        roles: ['volundr:admin'],
        displayName: 'Test User',
        status: 'active',
      });
    });
  });

  describe('getTenants', () => {
    it('returns transformed tenants from API', async () => {
      const apiResponse: import('./volundr.types').ApiTenantResponse[] = [
        {
          id: 't1',
          path: 't1',
          name: 'Tenant One',
          parent_id: null,
          tier: 'developer',
          max_sessions: 5,
          max_storage_gb: 50,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 't2',
          path: 't1.t2',
          name: 'Tenant Two',
          parent_id: 't1',
          tier: 'team',
          max_sessions: 10,
          max_storage_gb: 100,
          created_at: null,
        },
      ];
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const tenants = await service.getTenants();

      expect(tenants).toHaveLength(2);
      expect(tenants[0]).toMatchObject({
        id: 't1',
        path: 't1',
        name: 'Tenant One',
        tier: 'developer',
        maxSessions: 5,
        maxStorageGb: 50,
      });
      expect(tenants[0].parentId).toBeUndefined();
      expect(tenants[1].parentId).toBe('t1');
    });
  });

  describe('getTenant', () => {
    it('returns transformed tenant from API', async () => {
      const apiResponse: import('./volundr.types').ApiTenantResponse = {
        id: 't1',
        path: 't1',
        name: 'Tenant One',
        parent_id: null,
        tier: 'developer',
        max_sessions: 5,
        max_storage_gb: 50,
        created_at: '2024-01-01T00:00:00Z',
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const tenant = await service.getTenant('t1');

      expect(tenant).toMatchObject({
        id: 't1',
        name: 'Tenant One',
        maxSessions: 5,
      });
    });

    it('returns null for 404 response', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));

      const tenant = await service.getTenant('nonexistent');

      expect(tenant).toBeNull();
    });
  });

  describe('getUserCredentials', () => {
    it('returns transformed credentials from API', async () => {
      const apiResponse: import('./volundr.types').ApiCredentialListResponse = {
        credentials: [
          { name: 'github-token', keys: ['token'] },
          { name: 'aws-creds', keys: ['access_key', 'secret_key'] },
        ],
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const creds = await service.getUserCredentials();

      expect(creds).toHaveLength(2);
      expect(creds[0]).toEqual({ name: 'github-token', keys: ['token'] });
      expect(creds[1]).toEqual({ name: 'aws-creds', keys: ['access_key', 'secret_key'] });
    });
  });

  describe('storeUserCredential', () => {
    it('sends credential data to API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));

      await service.storeUserCredential('github-token', { token: 'abc123' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/secrets/user'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('deleteUserCredential', () => {
    it('sends delete request to API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(null, 204));

      await service.deleteUserCredential('github-token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/secrets/user/github-token'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('getTenantCredentials', () => {
    it('returns transformed credentials from API', async () => {
      const apiResponse: import('./volundr.types').ApiCredentialListResponse = {
        credentials: [{ name: 'shared-key', keys: ['key'] }],
      };
      mockFetch.mockReturnValueOnce(mockResponse(apiResponse));

      const creds = await service.getTenantCredentials();

      expect(creds).toHaveLength(1);
      expect(creds[0]).toEqual({ name: 'shared-key', keys: ['key'] });
    });
  });

  describe('storeTenantCredential', () => {
    it('sends credential data to API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}));

      await service.storeTenantCredential('shared-key', { key: 'val' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/secrets/tenant'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('deleteTenantCredential', () => {
    it('sends delete request to API', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(null, 204));

      await service.deleteTenantCredential('shared-key');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/secrets/tenant/shared-key'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('SSE fetch-based connection edge cases', () => {
    it('includes Authorization header when token is available', async () => {
      setTokenProvider(() => 'test-jwt-token');

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      setTokenProvider(null);
    });

    it('omits Authorization header when no token provider', async () => {
      setTokenProvider(null);

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });
    });

    it('handles SSE fetch returning non-ok response', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cleanupSSEMock();

      // Override to return 500
      global.fetch = ((url: string) => {
        if (url === '/api/v1/volundr/sessions/stream') {
          return Promise.resolve(new Response('error', { status: 500 }));
        }
        return mockFetch(url);
      }) as typeof fetch;

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('SSE connection error'),
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it('handles SSE fetch returning response with no body', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cleanupSSEMock();

      global.fetch = ((url: string) => {
        if (url === '/api/v1/volundr/sessions/stream') {
          // Response with null body
          const resp = new Response(null, { status: 200 });
          Object.defineProperty(resp, 'body', { value: null });
          return Promise.resolve(resp);
        }
        return mockFetch(url);
      }) as typeof fetch;

      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('SSE connection error'),
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it('does not open duplicate SSE connection when already connected', async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      service.subscribe(cb1);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Subscribe again — should not create a second connection
      service.subscribe(cb2);
      expect(MockSSEStream.instances).toHaveLength(1);
    });

    it('handles heartbeat events (no-op)', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      await MockSSEStream.instances[0].simulateEvent('heartbeat', {});

      // Heartbeat should not trigger any subscriber notifications
      expect(callback).not.toHaveBeenCalled();
    });

    it('handles SSE block with unknown event type', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      await MockSSEStream.instances[0].simulateEvent('unknown_event_type', { foo: 'bar' });

      // Unknown events should not trigger any subscriber notifications
      expect(callback).not.toHaveBeenCalled();
    });

    it('handles stream done signal gracefully', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Close the stream (triggers done=true)
      const stream = MockSSEStream.instances[0];
      stream.close();

      // Should not crash
      await new Promise(r => setTimeout(r, 10));
    });

    it('ignores SSE data lines without event type prefix', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Send block with comment/unknown lines
      await MockSSEStream.instances[0].simulateRawBlock(
        ': this is a comment\nevent: session_created\nid: 123\ndata: {"id":"s1","name":"test","model":"m","repo":"r","branch":"b","status":"running","chat_endpoint":null,"code_endpoint":null,"created_at":"2026-01-01T00:00:00","updated_at":"2026-01-01T00:00:00","last_active":"2026-01-01T00:00:00","message_count":0,"tokens_used":0,"pod_name":null,"error":null}\n\n'
      );

      expect(callback).toHaveBeenCalled();
    });

    it('handles log_received with no matching subscribers', async () => {
      // Subscribe to sessions (triggers SSE) but not to logs
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      // Send a log event — no log subscribers exist
      await MockSSEStream.instances[0].simulateEvent('log_received', {
        id: 'log-1',
        session_id: 'no-subscriber-session',
        timestamp: '2026-01-01T00:00:00',
        level: 'info',
        source: 'test',
        message: 'hello',
      });

      // Should not crash, session callback not called for log events
    });

    it('handles message_received with no matching subscribers', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      await MockSSEStream.instances[0].simulateEvent('message_received', {
        id: 'msg-1',
        session_id: 'no-subscriber-session',
        role: 'user',
        content: 'hi',
        created_at: '2026-01-01T00:00:00',
      });

      // Should not crash
    });

    it('handles chronicle_event with no matching subscribers', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      await vi.waitFor(() => {
        expect(MockSSEStream.instances).toHaveLength(1);
      });

      await MockSSEStream.instances[0].simulateEvent('chronicle_event', {
        session_id: 'no-subscriber-session',
        event: null,
        files: [],
        commits: [],
        token_burn: [],
      });

      // Should not crash
    });
  });
});
