import { createContext } from 'react';
import type { AppIdentity } from '@/modules/shared/ports/identity.port';

export interface IdentityContextValue {
  identity: AppIdentity | null;
  isAdmin: boolean;
  hasRole: (role: string) => boolean;
  loading: boolean;
  error: string | null;
}

export const IdentityContext = createContext<IdentityContextValue>({
  identity: null,
  isAdmin: false,
  hasRole: () => false,
  loading: true,
  error: null,
});
