/**
 * Service Registry
 *
 * This is the composition root where we wire up service implementations.
 *
 * In production: Uses real API adapters (calls /api/v1/*)
 * In development: Set VITE_USE_REAL_API=true to use real APIs,
 *                 otherwise uses mock adapters for offline dev.
 */

import {
  MockOdinService,
  MockRealmService,
  MockCampaignService,
  MockEinherjarService,
  MockChronicleService,
  MockMemoryService,
  MockMimirService,
  MockVolundrService,
} from './mock';

import { ApiVolundrService, ApiRealmService } from './api';

import type {
  IOdinService,
  IRealmService,
  ICampaignService,
  IEinherjarService,
  IChronicleService,
  IMemoryService,
  IMimirService,
  IVolundrService,
} from '@/modules/volundr/ports';

/**
 * Check if we should use real API adapters
 * Production builds always use real APIs.
 * Dev builds use mock unless VITE_USE_REAL_API=true
 */
function shouldUseRealApi(): boolean {
  // Production always uses real API
  if (import.meta.env.PROD) {
    return true;
  }

  // Dev: check env var
  return import.meta.env.VITE_USE_REAL_API === 'true';
}

/**
 * Create the appropriate Volundr service based on environment
 */
function createVolundrService(): IVolundrService {
  if (shouldUseRealApi()) {
    return new ApiVolundrService();
  }
  return new MockVolundrService();
}

/**
 * Create the appropriate Realm service based on environment
 */
function createRealmService(): IRealmService {
  if (shouldUseRealApi()) {
    return new ApiRealmService();
  }
  return new MockRealmService();
}

// Service instances (singletons)
export const odinService: IOdinService = new MockOdinService();
export const realmService: IRealmService = createRealmService();
export const campaignService: ICampaignService = new MockCampaignService();
export const einherjarService: IEinherjarService = new MockEinherjarService();
export const chronicleService: IChronicleService = new MockChronicleService();
export const memoryService: IMemoryService = new MockMemoryService();
export const mimirService: IMimirService = new MockMimirService();
export const volundrService: IVolundrService = createVolundrService();

/**
 * All services as a single object for convenience
 */
export const services = {
  odin: odinService,
  realm: realmService,
  campaign: campaignService,
  einherjar: einherjarService,
  chronicle: chronicleService,
  memory: memoryService,
  mimir: mimirService,
  volundr: volundrService,
} as const;
