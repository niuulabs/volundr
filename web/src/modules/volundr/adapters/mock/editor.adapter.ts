import type { IEditorService, WorkbenchConfig } from '@/modules/volundr/ports/editor.port';

/**
 * Mock editor adapter for tests and local development.
 * Returns predictable values based on the provided hostname.
 */
export class MockEditorAdapter implements IEditorService {
  getWorkbenchConfig(_sessionId: string, hostname: string): WorkbenchConfig {
    return {
      remoteAuthority: hostname,
      wsUrl: `wss://${hostname}/reh/`,
    };
  }
}
