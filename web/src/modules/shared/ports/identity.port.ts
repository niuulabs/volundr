/**
 * Shared identity port — service-agnostic identity interface.
 *
 * Modules that need to check identity or roles import from here
 * instead of coupling to IVolundrService.
 */

export interface AppIdentity {
  userId: string;
  email: string;
  tenantId: string;
  roles: string[];
  displayName: string;
  status: string;
}

export interface IIdentityService {
  getIdentity(): Promise<AppIdentity>;
}
