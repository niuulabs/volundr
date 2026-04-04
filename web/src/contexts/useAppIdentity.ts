import { useContext } from 'react';
import { IdentityContext, type IdentityContextValue } from './identityContextValue';

/**
 * Access the current user's identity.
 * Must be used within an IdentityProvider.
 */
export function useAppIdentity(): IdentityContextValue {
  return useContext(IdentityContext);
}
