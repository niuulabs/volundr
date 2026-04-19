import type { PodSpec } from './pod';

/** Reusable pod template stored in Völundr. Templates can be versioned and cloned. */
export interface Template {
  id: string;
  name: string;
  version: number;
  spec: PodSpec;
  createdAt: string;
  updatedAt: string;
}
