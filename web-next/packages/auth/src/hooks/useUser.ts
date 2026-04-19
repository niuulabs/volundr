import { useContext } from 'react';
import { AuthContext } from '../AuthContext';
import type { AuthUser } from '../ports/auth.port';

/**
 * Returns the current authenticated user, or null when not signed in.
 */
export function useUser(): AuthUser | null {
  return useContext(AuthContext).user;
}
