import { z } from 'zod';

/**
 * Deployment status of a Ravn node.
 */
export const ravnStatusSchema = z.enum(['active', 'idle', 'suspended', 'failed', 'completed']);

export type RavnStatus = z.infer<typeof ravnStatusSchema>;

/**
 * A Ravn is a deployed runtime instance bound to a Persona.
 * It represents a live or dormant agent node in the fleet.
 *
 * Owner: plugin-ravn (source of truth).
 */
export const ravnSchema = z.object({
  /** Unique identifier (UUID). */
  id: z.string().uuid(),
  /** Name of the Persona this ravn is bound to. */
  personaName: z.string().min(1),
  /** Current lifecycle state of the ravn. */
  status: ravnStatusSchema,
  /** LLM alias in use (e.g. "claude-sonnet-4-6"). */
  model: z.string().min(1),
  /** ISO-8601 UTC creation timestamp. */
  createdAt: z.string().datetime(),
  /** ISO-8601 UTC last-update timestamp. */
  updatedAt: z.string().datetime().optional(),
});

export type Ravn = z.infer<typeof ravnSchema>;
