import { z } from 'zod';

/**
 * Mount role within the Mimir knowledge system.
 *
 * - `local` — operator's own instance.
 * - `shared` — realm-wide instance.
 * - `domain` — prefix-scoped instance.
 *
 * @canonical Mimir — mount configuration.
 * @consumers Ravn (MountChip, raven detail), Volundr (session mounts).
 */
export const mountRoleSchema = z.enum(['local', 'shared', 'domain']);

export type MountRole = z.infer<typeof mountRoleSchema>;

/**
 * Health status of a mount.
 *
 * @canonical Mimir — mount health monitoring.
 * @consumers Observatory (topology canvas), Ravn (raven overview).
 */
export const mountStatusSchema = z.enum(['healthy', 'degraded', 'down']);

export type MountStatus = z.infer<typeof mountStatusSchema>;

/**
 * A Mimir mount — a standalone knowledge-graph instance.
 *
 * Each mount has its own host, embedding model, and page/source store.
 * Write routing rules determine which mount(s) receive writes for a
 * given page path prefix.
 *
 * @canonical Mimir — mount overview, routing editor.
 * @consumers Ravn (MountChip in raven detail — name + role + priority),
 *            Volundr (session mount bindings),
 *            Observatory (topology canvas — mimir_sub entities).
 */
export const mountSchema = z.object({
  name: z.string().min(1),
  role: mountRoleSchema,
  host: z.string().min(1),
  url: z.string().url(),
  priority: z.number().int().nonnegative(),
  categories: z.array(z.string()).nullable(),
  status: mountStatusSchema,
  pages: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  lintIssues: z.number().int().nonnegative(),
  lastWrite: z.string(),
  embedding: z.string().min(1),
  sizeKb: z.number().nonnegative(),
  desc: z.string(),
});

export type Mount = z.infer<typeof mountSchema>;
