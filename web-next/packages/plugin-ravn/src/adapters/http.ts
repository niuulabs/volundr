/**
 * Ravn — HTTP adapter.
 *
 * Wraps @niuulabs/query ApiClient for all Ravn service endpoints.
 * Persona endpoints are under /api/v1/ravn/personas (matching the existing
 * web/ client.ts). Fleet endpoints are under /api/v1/ravn/*.
 *
 * All server responses are snake_case; this adapter transforms them to
 * camelCase before returning, following the same convention as web/ client.ts.
 */

import type { ApiClient } from '@niuulabs/query';
import type { BudgetState } from '@niuulabs/domain';
import type {
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
  Raven,
  RavenMount,
  Session,
  Message,
  MessageKind,
  Trigger,
  TriggerInput,
} from '../domain';
import type {
  IPersonaStore,
  IRavenStream,
  ISessionStream,
  ITriggerStore,
  IBudgetStream,
  IRavnService,
} from '../ports';

// ---------------------------------------------------------------------------
// Raw server types (snake_case)
// ---------------------------------------------------------------------------

interface RawPersonaLLM {
  primary_alias: string;
  thinking_enabled: boolean;
  max_tokens: number;
}

interface RawPersonaProduces {
  event_type: string;
  schema_def: Record<string, unknown>;
}

interface RawPersonaConsumes {
  event_types: string[];
  injects: string[];
}

interface RawPersonaFanIn {
  strategy: string;
  contributes_to: string;
}

interface RawPersonaSummary {
  name: string;
  permission_mode: string;
  allowed_tools: string[];
  iteration_budget: number;
  is_builtin: boolean;
  has_override: boolean;
  produces_event: string;
  consumes_events: string[];
}

interface RawPersonaDetail extends RawPersonaSummary {
  system_prompt_template: string;
  forbidden_tools: string[];
  llm: RawPersonaLLM;
  produces: RawPersonaProduces;
  consumes: RawPersonaConsumes;
  fan_in: RawPersonaFanIn;
  yaml_source: string;
}

interface RawRavenMount {
  name: string;
  role: 'primary' | 'archive' | 'ro';
  priority: number;
}

interface RawRavenBudget {
  spent_usd: number;
  cap_usd: number;
  warn_at: number;
}

interface RawRaven {
  id: string;
  name: string;
  rune: string;
  persona: string;
  location: string;
  deployment: string;
  state: 'active' | 'idle' | 'suspended' | 'failed';
  uptime: number;
  last_tick: string;
  budget: RawRavenBudget;
  mounts: RawRavenMount[];
}

interface RawMessage {
  id: string;
  session_id: string;
  kind: MessageKind;
  body: string;
  ts: string;
  tool_name?: string;
  event_name?: string;
}

interface RawSession {
  id: string;
  ravn_id: string;
  title: string;
  trigger_id?: string;
  state: 'active' | 'idle' | 'suspended' | 'failed' | 'completed';
  started_at: string;
  last_at?: string;
  messages: RawMessage[];
}

interface RawTrigger {
  id: string;
  ravn_id: string;
  kind: 'cron' | 'event' | 'webhook' | 'manual';
  schedule?: string;
  description?: string;
  topic?: string;
  produces_event?: string;
  path?: string;
}


// ---------------------------------------------------------------------------
// Transform — persona
// ---------------------------------------------------------------------------

function toPersonaSummary(raw: RawPersonaSummary): PersonaSummary {
  return {
    name: raw.name,
    permissionMode: raw.permission_mode,
    allowedTools: raw.allowed_tools,
    iterationBudget: raw.iteration_budget,
    isBuiltin: raw.is_builtin,
    hasOverride: raw.has_override,
    producesEvent: raw.produces_event,
    consumesEvents: raw.consumes_events,
  };
}

function toPersonaDetail(raw: RawPersonaDetail): PersonaDetail {
  return {
    ...toPersonaSummary(raw),
    systemPromptTemplate: raw.system_prompt_template,
    forbiddenTools: raw.forbidden_tools,
    llm: {
      primaryAlias: raw.llm.primary_alias,
      thinkingEnabled: raw.llm.thinking_enabled,
      maxTokens: raw.llm.max_tokens,
    },
    produces: { eventType: raw.produces.event_type, schemaDef: raw.produces.schema_def },
    consumes: { eventTypes: raw.consumes.event_types, injects: raw.consumes.injects },
    fanIn: { strategy: raw.fan_in.strategy, contributesTo: raw.fan_in.contributes_to },
    yamlSource: raw.yaml_source,
  };
}

function toPersonaRequestBody(req: PersonaCreateRequest): Record<string, unknown> {
  return {
    name: req.name,
    system_prompt_template: req.systemPromptTemplate,
    allowed_tools: req.allowedTools,
    forbidden_tools: req.forbiddenTools,
    permission_mode: req.permissionMode,
    iteration_budget: req.iterationBudget,
    llm_primary_alias: req.llmPrimaryAlias,
    llm_thinking_enabled: req.llmThinkingEnabled,
    llm_max_tokens: req.llmMaxTokens,
    produces_event_type: req.producesEventType,
    consumes_event_types: req.consumesEventTypes,
    consumes_injects: req.consumesInjects,
    fan_in_strategy: req.fanInStrategy,
    fan_in_contributes_to: req.fanInContributesTo,
  };
}

// ---------------------------------------------------------------------------
// Transform — raven
// ---------------------------------------------------------------------------

function toRavenMount(raw: RawRavenMount): RavenMount {
  return { name: raw.name, role: raw.role, priority: raw.priority };
}

function toBudgetState(raw: RawRavenBudget): BudgetState {
  return {
    spentUsd: raw.spent_usd,
    capUsd: raw.cap_usd,
    warnAt: raw.warn_at,
  };
}

function toRaven(raw: RawRaven): Raven {
  return {
    id: raw.id,
    name: raw.name,
    rune: raw.rune,
    persona: raw.persona,
    location: raw.location,
    deployment: raw.deployment,
    state: raw.state,
    uptime: raw.uptime,
    lastTick: raw.last_tick,
    budget: toBudgetState(raw.budget),
    mounts: raw.mounts.map(toRavenMount),
  };
}

// ---------------------------------------------------------------------------
// Transform — message + session
// ---------------------------------------------------------------------------

function toMessage(raw: RawMessage): Message {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    kind: raw.kind,
    body: raw.body,
    ts: raw.ts,
    toolName: raw.tool_name,
    eventName: raw.event_name,
  };
}

function toSession(raw: RawSession): Session {
  return {
    id: raw.id,
    ravnId: raw.ravn_id,
    title: raw.title,
    triggerId: raw.trigger_id,
    state: raw.state,
    startedAt: raw.started_at,
    lastAt: raw.last_at,
    messages: raw.messages.map(toMessage),
  };
}

// ---------------------------------------------------------------------------
// Transform — trigger
// ---------------------------------------------------------------------------

function toTrigger(raw: RawTrigger): Trigger {
  if (raw.kind === 'cron') {
    return {
      id: raw.id,
      ravnId: raw.ravn_id,
      kind: 'cron',
      schedule: raw.schedule ?? '',
      description: raw.description ?? '',
    };
  }
  if (raw.kind === 'event') {
    return {
      id: raw.id,
      ravnId: raw.ravn_id,
      kind: 'event',
      topic: raw.topic ?? '',
      producesEvent: raw.produces_event,
    };
  }
  if (raw.kind === 'webhook') {
    return { id: raw.id, ravnId: raw.ravn_id, kind: 'webhook', path: raw.path ?? '' };
  }
  return { id: raw.id, ravnId: raw.ravn_id, kind: 'manual' };
}

function toTriggerBody(trigger: TriggerInput): Record<string, unknown> {
  const base: Record<string, unknown> = { ravn_id: trigger.ravnId, kind: trigger.kind };
  if (trigger.kind === 'cron') {
    base['schedule'] = trigger.schedule;
    base['description'] = trigger.description;
  } else if (trigger.kind === 'event') {
    base['topic'] = trigger.topic;
    if (trigger.producesEvent) base['produces_event'] = trigger.producesEvent;
  } else if (trigger.kind === 'webhook') {
    base['path'] = trigger.path;
  }
  return base;
}

// ---------------------------------------------------------------------------
// HTTP persona store
// ---------------------------------------------------------------------------

function createHttpPersonaStore(client: ApiClient): IPersonaStore {
  return {
    async listPersonas(filter: PersonaFilter = 'all') {
      const raw = await client.get<RawPersonaSummary[]>(`/personas?source=${filter}`);
      return raw.map(toPersonaSummary);
    },

    async getPersona(name: string) {
      const raw = await client.get<RawPersonaDetail>(`/personas/${encodeURIComponent(name)}`);
      return toPersonaDetail(raw);
    },

    async getPersonaYaml(name: string) {
      return client.get<string>(`/personas/${encodeURIComponent(name)}/yaml`);
    },

    async createPersona(req: PersonaCreateRequest) {
      const raw = await client.post<RawPersonaDetail>('/personas', toPersonaRequestBody(req));
      return toPersonaDetail(raw);
    },

    async updatePersona(name: string, req: PersonaCreateRequest) {
      const raw = await client.put<RawPersonaDetail>(
        `/personas/${encodeURIComponent(name)}`,
        toPersonaRequestBody(req),
      );
      return toPersonaDetail(raw);
    },

    async deletePersona(name: string) {
      await client.delete<void>(`/personas/${encodeURIComponent(name)}`);
    },

    async forkPersona(name: string, req: PersonaForkRequest) {
      const raw = await client.post<RawPersonaDetail>(
        `/personas/${encodeURIComponent(name)}/fork`,
        { new_name: req.newName },
      );
      return toPersonaDetail(raw);
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP raven stream
// ---------------------------------------------------------------------------

function createHttpRavenStream(client: ApiClient): IRavenStream {
  return {
    async listRavens() {
      const raw = await client.get<RawRaven[]>('/ravens');
      return raw.map(toRaven);
    },

    async getRaven(id: string) {
      const raw = await client.get<RawRaven>(`/ravens/${encodeURIComponent(id)}`);
      return toRaven(raw);
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP session stream
// ---------------------------------------------------------------------------

function createHttpSessionStream(client: ApiClient): ISessionStream {
  return {
    async listSessions(ravnId?: string) {
      const query = ravnId ? `?ravn_id=${encodeURIComponent(ravnId)}` : '';
      const raw = await client.get<RawSession[]>(`/sessions${query}`);
      return raw.map(toSession);
    },

    async getSession(id: string) {
      const raw = await client.get<RawSession>(`/sessions/${encodeURIComponent(id)}`);
      return toSession(raw);
    },

    async getMessages(sessionId: string) {
      const raw = await client.get<RawMessage[]>(
        `/sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      return raw.map(toMessage);
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP trigger store
// ---------------------------------------------------------------------------

function createHttpTriggerStore(client: ApiClient): ITriggerStore {
  return {
    async listTriggers(ravnId?: string) {
      const query = ravnId ? `?ravn_id=${encodeURIComponent(ravnId)}` : '';
      const raw = await client.get<RawTrigger[]>(`/triggers${query}`);
      return raw.map(toTrigger);
    },

    async createTrigger(trigger: TriggerInput) {
      const raw = await client.post<RawTrigger>('/triggers', toTriggerBody(trigger));
      return toTrigger(raw);
    },

    async deleteTrigger(id: string) {
      await client.delete<void>(`/triggers/${encodeURIComponent(id)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP budget stream
// ---------------------------------------------------------------------------

function createHttpBudgetStream(client: ApiClient): IBudgetStream {
  return {
    async getFleetBudget() {
      const raw = await client.get<RawBudget>('/budget');
      return toBudgetState(raw);
    },

    async getRavenBudget(ravnId: string) {
      const raw = await client.get<RawBudget>(`/ravens/${encodeURIComponent(ravnId)}/budget`);
      return toBudgetState(raw);
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createHttpRavnService(client: ApiClient): IRavnService {
  return {
    personas: createHttpPersonaStore(client),
    ravens: createHttpRavenStream(client),
    sessions: createHttpSessionStream(client),
    triggers: createHttpTriggerStore(client),
    budget: createHttpBudgetStream(client),
  };
}
