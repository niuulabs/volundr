import type { IDispatcherService } from '../../ports';
import type { DispatcherState } from '../../models';
import { mockDispatcherState, mockDispatcherLog } from './data';

export class MockDispatcherService implements IDispatcherService {
  private state: DispatcherState = { ...mockDispatcherState };

  async getState(): Promise<DispatcherState | null> {
    return { ...this.state };
  }

  async setRunning(running: boolean): Promise<void> {
    this.state = {
      ...this.state,
      running,
      updated_at: new Date().toISOString(),
    };
  }

  async setThreshold(threshold: number): Promise<void> {
    this.state = {
      ...this.state,
      threshold,
      updated_at: new Date().toISOString(),
    };
  }

  async setAutoContinue(autoContinue: boolean): Promise<void> {
    this.state = {
      ...this.state,
      auto_continue: autoContinue,
      updated_at: new Date().toISOString(),
    };
  }

  async getLog(): Promise<string[]> {
    return [...mockDispatcherLog];
  }
}
