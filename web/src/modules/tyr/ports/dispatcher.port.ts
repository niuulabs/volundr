import type { DispatcherState } from '../models';

export interface IDispatcherService {
  getState(): Promise<DispatcherState | null>;
  setRunning(running: boolean): Promise<void>;
  setThreshold(threshold: number): Promise<void>;
  setAutoContinue(autoContinue: boolean): Promise<void>;
  getLog(): Promise<string[]>;
}
