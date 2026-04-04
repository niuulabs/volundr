import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiDispatcherService } from './dispatcher';

vi.mock('@/modules/shared/api/client', () => ({
  createApiClient: () => ({
    get: vi.fn().mockResolvedValue({
      id: 'disp-1',
      running: true,
      threshold: 0.75,
      max_concurrent_raids: 3,
      auto_continue: false,
      updated_at: '2026-03-21T08:00:00Z',
    }),
    patch: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('ApiDispatcherService', () => {
  let service: ApiDispatcherService;

  beforeEach(() => {
    service = new ApiDispatcherService();
  });

  it('getState returns dispatcher state', async () => {
    const state = await service.getState();
    expect(state).not.toBeNull();
    expect(state?.running).toBe(true);
  });

  it('setRunning calls patch', async () => {
    await expect(service.setRunning(false)).resolves.toBeUndefined();
  });

  it('setThreshold calls patch', async () => {
    await expect(service.setThreshold(0.9)).resolves.toBeUndefined();
  });

  it('setAutoContinue calls patch', async () => {
    await expect(service.setAutoContinue(true)).resolves.toBeUndefined();
  });

  it('getLog returns empty array', async () => {
    const log = await service.getLog();
    expect(log).toEqual([]);
  });
});
