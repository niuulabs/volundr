/**
 * Ravn plugin port interfaces + persona API types.
 *
 * All types in this file are either pure TypeScript interfaces (no runtime
 * cost) or type aliases. Implementations live in src/adapters/.
 */

import type { BudgetState } from '@niuulabs/domain';
import type { Ravn } from './domain/ravn';
import type { Session } from './domain/session';
import type { Trigger } from './domain/trigger';
import type { Message } from './domain/message';

// ---------------------------------------------------------------------------
// Persona API types — migrated from web/src/modules/ravn/api/types.ts
// (camelCase client representation of the snake_case server responses)
// ---------------------------------------------------------------------------

export interface PersonaLLM {
  primaryAlias: string;
  thinkingEnabled: boolean;
  maxTokens: number;
}

export interface PersonaProduces {
  eventType: string;
  schemaDef: Record<string, unknown>;
}

export interface PersonaConsumes {
  eventTypes: string[];
  injects: string[];
}

export interface PersonaFanIn {
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
  produces: PersonaProduces;
  consumes: PersonaConsumes;
  fanIn: PersonaFanIn;
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

export type PersonaFilter = 'all' | 'builtin' | 'custom';

// ---------------------------------------------------------------------------
// Port interfaces
// ---------------------------------------------------------------------------

/** CRUD store for Persona configurations. */
export interface IPersonaStore {
  listPersonas(filter?: PersonaFilter): Promise<PersonaSummary[]>;
  getPersona(name: string): Promise<PersonaDetail>;
  getPersonaYaml(name: string): Promise<string>;
  createPersona(req: PersonaCreateRequest): Promise<PersonaDetail>;
  updatePersona(name: string, req: PersonaCreateRequest): Promise<PersonaDetail>;
  deletePersona(name: string): Promise<void>;
  forkPersona(name: string, req: PersonaForkRequest): Promise<PersonaDetail>;
}

/** Read stream for Ravn fleet state. */
export interface IRavenStream {
  listRavens(): Promise<Ravn[]>;
  getRaven(id: string): Promise<Ravn>;
}

/** Read stream for Session transcripts. */
export interface ISessionStream {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  getMessages(sessionId: string): Promise<Message[]>;
}

/** CRUD store for Triggers. */
export interface ITriggerStore {
  listTriggers(): Promise<Trigger[]>;
  createTrigger(t: Omit<Trigger, 'id' | 'createdAt'>): Promise<Trigger>;
  deleteTrigger(id: string): Promise<void>;
}

/** Read stream for Budget state. */
export interface IBudgetStream {
  getBudget(ravnId: string): Promise<BudgetState>;
  getFleetBudget(): Promise<BudgetState>;
}
