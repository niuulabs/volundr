import { z } from 'zod';

/**
 * The nine canonical persona roles in the Niuu system.
 *
 * Each role maps to a deterministic visual shape in the UI (PersonaAvatar).
 *
 * @canonical Ravn — owns the persona library (`src/ravn/personas/*.yaml`).
 * @consumers Tyr (workflow editor, dispatch), Observatory (topology canvas),
 *            Volundr (session binding), Mimir (write routing).
 */
export const personaRoleSchema = z.enum([
  'plan',
  'build',
  'verify',
  'review',
  'gate',
  'audit',
  'ship',
  'index',
  'report',
]);

export type PersonaRole = z.infer<typeof personaRoleSchema>;

/**
 * Permission mode governing tool access for a persona.
 *
 * - `default` — standard guardrails.
 * - `safe` — restricted to non-destructive tools only.
 * - `loose` — all tools allowed unless explicitly forbidden.
 *
 * @canonical Ravn — persona editor.
 * @consumers Tyr (dispatch feasibility), Volundr (session tool allowlist).
 */
export const permissionModeSchema = z.enum(['default', 'safe', 'loose']);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

/**
 * Mimir write routing target for a persona.
 *
 * Controls which mount a persona writes knowledge to during operation.
 *
 * @canonical Ravn — persona editor.
 * @consumers Mimir (route-write resolution).
 */
export const mimirWriteRoutingSchema = z.enum(['local', 'shared', 'domain']);

export type MimirWriteRouting = z.infer<typeof mimirWriteRoutingSchema>;

/**
 * Fan-in strategy names for multi-producer event aggregation.
 *
 * @canonical Ravn — fan-in configurator.
 * @consumers Tyr (workflow validation — `fan_in_misconfig` rule).
 */
export const fanInStrategyNameSchema = z.enum([
  'all_must_pass',
  'any_passes',
  'quorum',
  'merge',
  'first_wins',
  'weighted_score',
]);

export type FanInStrategyName = z.infer<typeof fanInStrategyNameSchema>;

/**
 * Fan-in configuration: a strategy name with strategy-specific parameters.
 *
 * @canonical Ravn — FanInSection in persona editor.
 * @consumers Tyr (workflow validation).
 */
export const fanInConfigSchema = z.object({
  strategy: fanInStrategyNameSchema,
  params: z.record(z.string(), z.unknown()),
});

export type FanInConfig = z.infer<typeof fanInConfigSchema>;

/**
 * LLM configuration bound to a persona.
 *
 * @canonical Ravn — persona LLM section.
 * @consumers Tyr (dispatch), Observatory (entity detail drawer).
 */
export const personaLlmSchema = z.object({
  alias: z.string().min(1),
  thinking: z.boolean(),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2).optional(),
});

export type PersonaLlm = z.infer<typeof personaLlmSchema>;

/**
 * A single event that a persona consumes, with optional inject snippets
 * and a producer-trust threshold.
 *
 * @canonical Ravn — ConsumesSection in persona editor.
 * @consumers Tyr (workflow validation — `no_producer` / `no_consumer` rules).
 */
export const consumedEventSchema = z.object({
  name: z.string().min(1),
  injects: z.array(z.string()).optional(),
  trust: z.number().min(0).max(1).optional(),
});

export type ConsumedEvent = z.infer<typeof consumedEventSchema>;

/**
 * The event a persona produces, including the payload schema.
 *
 * @canonical Ravn — ProducesSection in persona editor.
 * @consumers Tyr (workflow validation).
 */
export const personaProducesSchema = z.object({
  event: z.string().min(1),
  schema: z.record(z.string(), z.string()),
});

export type PersonaProduces = z.infer<typeof personaProducesSchema>;

/**
 * Events a persona consumes.
 *
 * @canonical Ravn — ConsumesSection in persona editor.
 * @consumers Tyr (workflow validation).
 */
export const personaConsumesSchema = z.object({
  events: z.array(consumedEventSchema),
});

export type PersonaConsumes = z.infer<typeof personaConsumesSchema>;

/**
 * A persona template — the canonical shape for the raven personality library.
 *
 * Matches `src/ravn/personas/*.yaml` and `data.jsx::PERSONAS` from the Ravn
 * handoff prototype. Any number of ravens can bind to a single persona.
 *
 * @canonical Ravn — persona editor + library browser.
 * @consumers Tyr (workflow editor, plan wizard, dispatch),
 *            Observatory (topology canvas — persona-colored nodes),
 *            Volundr (session binding — persona → pod template),
 *            Mimir (write routing — `mimirWriteRouting`).
 */
export const personaSchema = z.object({
  name: z.string().min(1),
  role: personaRoleSchema,
  color: z.string().min(1),
  letter: z.string().length(1),
  summary: z.string(),
  description: z.string(),
  llm: personaLlmSchema,
  permissionMode: permissionModeSchema,
  allowed: z.array(z.string()),
  forbidden: z.array(z.string()),
  produces: personaProducesSchema,
  consumes: personaConsumesSchema,
  fanIn: fanInConfigSchema.optional(),
  mimirWriteRouting: mimirWriteRoutingSchema.optional(),
});

export type Persona = z.infer<typeof personaSchema>;
