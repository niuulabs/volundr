import type { APIRequestContext } from '@playwright/test';

const API_BASE = '/api/v1/volundr';

export interface CreateSessionPayload {
  name: string;
  model: string;
  source: {
    type: 'git' | 'local_mount';
    repo?: string;
    branch?: string;
    local_path?: string;
    paths?: { host_path: string; mount_path: string; read_only?: boolean }[];
  };
  template_name?: string | null;
  task_type?: string | null;
  terminal_restricted?: boolean;
}

export interface SessionResponse {
  id: string;
  name: string;
  model: string;
  status: string;
  source: Record<string, unknown>;
}

let sessionCounter = 0;

/**
 * Generate a unique RFC 1123 compliant session name for test isolation.
 */
export function uniqueSessionName(prefix = 'e2e-test'): string {
  sessionCounter += 1;
  const ts = Date.now().toString(36);
  return `${prefix}-${ts}-${sessionCounter}`;
}

/**
 * Create a session via the backend API, bypassing the UI for fast seeding.
 */
export async function createSession(
  request: APIRequestContext,
  overrides: Partial<CreateSessionPayload> = {},
): Promise<SessionResponse> {
  const payload: CreateSessionPayload = {
    name: uniqueSessionName(),
    model: 'sonnet',
    source: { type: 'local_mount', local_path: '/tmp/e2e-workspace' },
    template_name: null,
    task_type: null,
    terminal_restricted: false,
    ...overrides,
  };

  const response = await request.post(`${API_BASE}/sessions`, {
    data: payload,
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to create session (${response.status()}): ${body}`);
  }

  return response.json();
}

/**
 * Delete a session via the backend API for cleanup.
 */
export async function deleteSession(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE}/sessions/${sessionId}`, {
    data: { cleanup: [] },
  });

  if (!response.ok() && response.status() !== 404) {
    const body = await response.text();
    throw new Error(`Failed to delete session (${response.status()}): ${body}`);
  }
}

/**
 * List sessions via the backend API.
 */
export async function listSessions(
  request: APIRequestContext,
): Promise<SessionResponse[]> {
  const response = await request.get(`${API_BASE}/sessions`);

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to list sessions (${response.status()}): ${body}`);
  }

  return response.json();
}

/**
 * Fetch available models from the backend.
 */
export async function listModels(
  request: APIRequestContext,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${API_BASE}/models`);

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to list models (${response.status()}): ${body}`);
  }

  return response.json();
}
