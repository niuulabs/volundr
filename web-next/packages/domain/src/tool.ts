import { z } from 'zod';

/**
 * Tool group / provider category.
 *
 * Groups tools by their origin system for the ToolPicker UI.
 *
 * @canonical Ravn — TOOL_REGISTRY in `data.jsx`.
 * @consumers Tyr (workflow inspector — tool access review),
 *            Volundr (template editor — tool allowlist).
 */
export const toolGroupSchema = z.enum([
  'fs',
  'shell',
  'git',
  'mimir',
  'observe',
  'security',
  'bus',
]);

export type ToolGroup = z.infer<typeof toolGroupSchema>;

/**
 * A single tool in the Niuu tool registry.
 *
 * Every tool has a unique `id`, belongs to a `group`, and may be flagged
 * `destructive`. Destructive tools render with a warning stripe in allow
 * lists and a red dot in the UI.
 *
 * @canonical Ravn — TOOL_REGISTRY, ToolPicker, persona editor tool-access section.
 * @consumers Tyr (workflow inspector — tool validation),
 *            Volundr (template tool allowlist).
 */
export const toolSchema = z.object({
  id: z.string().min(1),
  group: toolGroupSchema,
  destructive: z.boolean(),
  desc: z.string(),
});

export type Tool = z.infer<typeof toolSchema>;

/**
 * The full tool registry — an ordered collection of available tools.
 *
 * @canonical Ravn — TOOL_REGISTRY.
 * @consumers Tyr, Volundr.
 */
export const toolRegistrySchema = z.array(toolSchema);

export type ToolRegistry = z.infer<typeof toolRegistrySchema>;
