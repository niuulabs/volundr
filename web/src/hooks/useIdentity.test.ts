import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useIdentity } from './useIdentity';
import type { IVolundrService } from '@/ports';
import type { VolundrIdentity } from '@/models';

function createMockService(getIdentity: () => Promise<VolundrIdentity>): IVolundrService {
  return { getIdentity } as unknown as IVolundrService;
}

const adminIdentity: VolundrIdentity = {
  userId: 'u-1',
  email: 'admin@test.com',
  tenantId: 't-1',
  roles: ['volundr:admin', 'volundr:developer'],
  displayName: 'Admin',
  status: 'active',
};

const regularIdentity: VolundrIdentity = {
  userId: 'u-2',
  email: 'dev@test.com',
  tenantId: 't-1',
  roles: ['volundr:developer'],
  displayName: 'Dev',
  status: 'active',
};

describe('useIdentity', () => {
  it('returns loading state initially', () => {
    const service = createMockService(() => new Promise(() => {}));
    const { result } = renderHook(() => useIdentity(service));
    expect(result.current.loading).toBe(true);
    expect(result.current.identity).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it('returns identity on success', async () => {
    const service = createMockService(() => Promise.resolve(regularIdentity));
    const { result } = renderHook(() => useIdentity(service));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.identity).toEqual(regularIdentity);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('detects admin role', async () => {
    const service = createMockService(() => Promise.resolve(adminIdentity));
    const { result } = renderHook(() => useIdentity(service));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isAdmin).toBe(true);
  });

  it('returns error on failure with Error', async () => {
    const service = createMockService(() => Promise.reject(new Error('Network error')));
    const { result } = renderHook(() => useIdentity(service));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.identity).toBeNull();
  });

  it('returns fallback error on non-Error rejection', async () => {
    const service = createMockService(() => Promise.reject('oops'));
    const { result } = renderHook(() => useIdentity(service));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Failed to load identity');
  });

  it('ignores result after unmount', async () => {
    let resolve: (v: VolundrIdentity) => void;
    const promise = new Promise<VolundrIdentity>(r => {
      resolve = r;
    });
    const service = createMockService(() => promise);
    const { result, unmount } = renderHook(() => useIdentity(service));
    unmount();
    resolve!(adminIdentity);
    // After unmount, state shouldn't update (no error thrown)
    expect(result.current.loading).toBe(true);
  });
});
