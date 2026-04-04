import { createApiClient } from '@/modules/shared/api/client';
import type { IDispatcherService } from '../../ports';
import type { DispatcherState } from '../../models';

const api = createApiClient('/api/v1/tyr/dispatcher');

export class ApiDispatcherService implements IDispatcherService {
  async getState(): Promise<DispatcherState | null> {
    return api.get<DispatcherState>('');
  }

  async setRunning(running: boolean): Promise<void> {
    await api.patch('', { running });
  }

  async setThreshold(threshold: number): Promise<void> {
    await api.patch('', { threshold });
  }

  async setAutoContinue(autoContinue: boolean): Promise<void> {
    await api.patch('', { auto_continue: autoContinue });
  }

  async getLog(): Promise<string[]> {
    return [];
  }
}
