/**
 * Ravn plugin — local domain types.
 *
 * Ravn is the canonical authority for the runtime fleet model.
 * Persona, ToolRegistry, EventCatalog, BudgetState are shared cross-plugin
 * types that live in @niuulabs/domain; the shapes below are Ravn-specific.
 *
 * Persona API types (PersonaSummary, PersonaDetail, etc.) are the
 * HTTP-layer representation, distinct from the template schema in @niuulabs/domain.
 */

import { z } from 'zod';
import { budgetStateSchema } from '@niuulabs/domain';

// ---------------------------------------------------------------------------
// Raven — deployed agent node
// ---------------------------------------------------------------------------

export const ravenStateSchema = z.enum(['active', 'idle', 'suspended', 'failed']);
export type RavenState = z.infer<typeof ravenStateSchema>;

export const ravenMountSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['primary', 'archive', 'ro']),
  priority: z.number().int().nonnegative(),
});
export type RavenMount = z.infer<typeof ravenMountSchema>;

export const ravenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rune: z.string().min(1),
  persona: z.string().min(1),
  location: z.string().min(1),
  deployment: z.string().min(1),
  state: ravenStateSchema,
  uptime: z.number().nonnegative(),
  lastTick: z.string(),
  budget: budgetStateSchema,
  mounts: z.array(ravenMountSchema),
});
export type Raven = z.infer<typeof ravenSchema>;

// ---------------------------------------------------------------------------
// Message — transcript unit with 7 kinds
// ---------------------------------------------------------------------------

export const messageKindSchema = z.enum([
  'user',
  'asst',
  'system',
  'tool_call',
  'tool_result',
  'emit',
  'think',
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  kind: messageKindSchema,
  body: z.string(),
  ts: z.string(),
  toolName: z.string().optional(),
  eventName: z.string().optional(),
});
export type Message = z.infer<typeof messageSchema>;

// ---------------------------------------------------------------------------
// Session — live interaction thread
// ---------------------------------------------------------------------------

export const sessionStateSchema = z.enum(['active', 'idle', 'suspended', 'failed', 'completed']);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  ravnId: z.string().min(1),
  title: z.string(),
  triggerId: z.string().optional(),
  state: sessionStateSchema,
  startedAt: z.string(),
  lastAt: z.string().optional(),
  messages: z.array(messageSchema),
});
export type Session = z.infer<typeof sessionSchema>;

// ---------------------------------------------------------------------------
// Trigger — initiative subscription (discriminated union by kind)
// ---------------------------------------------------------------------------

export const cronTriggerSchema = z.object({
  id: z.string().min(1),
  ravnId: z.string().min(1),
  kind: z.literal('cron'),
  schedule: z.string().min(1),
  description: z.string(),
});
export type CronTrigger = z.infer<typeof cronTriggerSchema>;

export const eventTriggerSchema = z.object({
  id: z.string().min(1),
  ravnId: z.string().min(1),
  kind: z.literal('event'),
  topic: z.string().min(1),
  producesEvent: z.string().optional(),
});
export type EventTrigger = z.infer<typeof eventTriggerSchema>;

export const webhookTriggerSchema = z.object({
  id: z.string().min(1),
  ravnId: z.string().min(1),
  kind: z.literal('webhook'),
  path: z.string().min(1),
});
export type WebhookTrigger = z.infer<typeof webhookTriggerSchema>;

export const manualTriggerSchema = z.object({
  id: z.string().min(1),
  ravnId: z.string().min(1),
  kind: z.literal('manual'),
});
export type ManualTrigger = z.infer<typeof manualTriggerSchema>;

export const triggerSchema = z.discriminatedUnion('kind', [
  cronTriggerSchema,
  eventTriggerSchema,
  webhookTriggerSchema,
  manualTriggerSchema,
]);
export type Trigger = z.infer<typeof triggerSchema>;

/**
 * Trigger creation input — the discriminated union without the server-assigned id.
 *
 * Defined as an explicit union (not Omit<Trigger, 'id'>) so TypeScript can
 * correctly narrow by the `kind` discriminant in adapter code.
 */
export type TriggerInput =
  | Omit<CronTrigger, 'id'>
  | Omit<EventTrigger, 'id'>
  | Omit<WebhookTrigger, 'id'>
  | Omit<ManualTrigger, 'id'>;

// ---------------------------------------------------------------------------
// Persona API types (copied from web/src/modules/ravn/api/types.ts)
//
// These are the camelCase HTTP-layer representations, distinct from the
// domain-level Persona template schema in @niuulabs/domain.
// ---------------------------------------------------------------------------

export type PersonaFilter = 'all' | 'builtin' | 'custom';

export interface PersonaLLM {
  primaryAlias: string;
  thinkingEnabled: boolean;
  maxTokens: number;
}

export interface PersonaProducesConfig {
  eventType: string;
  schemaDef: Record<string, unknown>;
}

export interface PersonaConsumesConfig {
  eventTypes: string[];
  injects: string[];
}

export interface PersonaFanInConfig {
  strategy: string;
  contributesTo: string;
}

export interface PersonaSummary {
  name: string;
  permissionMode: string;
  allowedTools: string[];
  iterationBudget: number;
  isBuiltin: boolean;
  hasOverride: boolean;
  producesEvent: string;
  consumesEvents: string[];
}

export interface PersonaDetail extends PersonaSummary {
  systemPromptTemplate: string;
  forbiddenTools: string[];
  llm: PersonaLLM;
  produces: PersonaProducesConfig;
  consumes: PersonaConsumesConfig;
  fanIn: PersonaFanInConfig;
  yamlSource: string;
}

export interface PersonaCreateRequest {
  name: string;
  systemPromptTemplate: string;
  allowedTools: string[];
  forbiddenTools: string[];
  permissionMode: string;
  iterationBudget: number;
  llmPrimaryAlias: string;
  llmThinkingEnabled: boolean;
  llmMaxTokens: number;
  producesEventType: string;
  consumesEventTypes: string[];
  consumesInjects: string[];
  fanInStrategy: string;
  fanInContributesTo: string;
}

export interface PersonaForkRequest {
  newName: string;
}
