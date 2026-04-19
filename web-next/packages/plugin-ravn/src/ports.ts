/**
 * Ravn plugin — port interfaces (hexagonal architecture).
 *
 * These interfaces are the only thing business logic and UI may depend on.
 * Adapters (mock, http) implement these ports. This file is intentionally
 * excluded from coverage thresholds — it contains only type declarations.
 */

import type { BudgetState } from '@niuulabs/domain';
import type {
  Raven,
  Session,
  Message,
  Trigger,
  TriggerInput,
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
} from './domain';

// ---------------------------------------------------------------------------
// IPersonaStore — CRUD over the persona template library
// ---------------------------------------------------------------------------

export interface IPersonaStore {
  listPersonas(filter?: PersonaFilter): Promise<PersonaSummary[]>;
  getPersona(name: string): Promise<PersonaDetail>;
  getPersonaYaml(name: string): Promise<string>;
  createPersona(req: PersonaCreateRequest): Promise<PersonaDetail>;
  updatePersona(name: string, req: PersonaCreateRequest): Promise<PersonaDetail>;
  deletePersona(name: string): Promise<void>;
  forkPersona(name: string, req: PersonaForkRequest): Promise<PersonaDetail>;
}

// ---------------------------------------------------------------------------
// IRavenStream — read-only fleet view
// ---------------------------------------------------------------------------

export interface IRavenStream {
  listRavens(): Promise<Raven[]>;
  getRaven(id: string): Promise<Raven>;
}

// ---------------------------------------------------------------------------
// ISessionStream — read-only session + transcript view
// ---------------------------------------------------------------------------

export interface ISessionStream {
  listSessions(ravnId?: string): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  getMessages(sessionId: string): Promise<Message[]>;
}

// ---------------------------------------------------------------------------
// ITriggerStore — trigger CRUD
// ---------------------------------------------------------------------------

export interface ITriggerStore {
  listTriggers(ravnId?: string): Promise<Trigger[]>;
  createTrigger(trigger: TriggerInput): Promise<Trigger>;
  deleteTrigger(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// IBudgetStream — daily spend tracking
// ---------------------------------------------------------------------------

export interface IBudgetStream {
  getFleetBudget(): Promise<BudgetState>;
  getRavenBudget(ravnId: string): Promise<BudgetState>;
}

// ---------------------------------------------------------------------------
// IRavnService — top-level bundle registered in ServicesProvider
// ---------------------------------------------------------------------------

export interface IRavnService {
  personas: IPersonaStore;
  ravens: IRavenStream;
  sessions: ISessionStream;
  triggers: ITriggerStore;
  budget: IBudgetStream;
}
