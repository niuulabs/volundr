import { z } from 'zod';

/**
 * Budget state for a raven or the fleet.
 *
 * Tracks daily USD spend against a configured cap with an early-warning
 * threshold (`warnAt`). The Budget view uses this to render BudgetBar,
 * BudgetRunwayBar, and the attention columns (burning fast / near cap / idle).
 *
 * @canonical Ravn — budget stream, per-raven budget field.
 * @consumers Tyr (dispatch feasibility — budget check),
 *            Observatory (raven entity drawer — token throughput section).
 */
export const budgetStateSchema = z.object({
  spentUsd: z.number().nonnegative(),
  capUsd: z.number().positive(),
  warnAt: z.number().nonnegative(),
});

export type BudgetState = z.infer<typeof budgetStateSchema>;
