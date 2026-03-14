import type { IEditorService, WorkbenchConfig } from '@/ports/editor.port';

/**
 * Mock editor adapter for tests and local development.
 * Returns predictable values based on the provided hostname.
 */
export class MockEditorAdapter implements IEditorService {
  getWorkbenchConfig(_sessionId: string, hostname: string): WorkbenchConfig {
    return {
      remoteAuthority: `${hostname}:8445`,
      wsUrl: `wss://${hostname}/reh/`,
    };
  }
}
