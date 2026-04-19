/**
 * HTTP adapter for IPersonaStore.
 *
 * Adapted from web/src/modules/ravn/api/client.ts.
 * Translates snake_case server responses to camelCase domain types.
 *
 * Accepts any HTTP client structurally compatible with ApiClient from
 * @niuulabs/query (i.e. has get/post/put/delete methods).
 */

import type { ApiClient } from '@niuulabs/query';
import type {
  IPersonaStore,
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
} from '../ports';

// ---------------------------------------------------------------------------
// Internal raw types (snake_case server responses)
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

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

function toSummary(raw: RawPersonaSummary): PersonaSummary {
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

function toDetail(raw: RawPersonaDetail): PersonaDetail {
  return {
    ...toSummary(raw),
    systemPromptTemplate: raw.system_prompt_template,
    forbiddenTools: raw.forbidden_tools,
    llm: {
      primaryAlias: raw.llm.primary_alias,
      thinkingEnabled: raw.llm.thinking_enabled,
      maxTokens: raw.llm.max_tokens,
    },
    produces: {
      eventType: raw.produces.event_type,
      schemaDef: raw.produces.schema_def,
    },
    consumes: {
      eventTypes: raw.consumes.event_types,
      injects: raw.consumes.injects,
    },
    fanIn: {
      strategy: raw.fan_in.strategy,
      contributesTo: raw.fan_in.contributes_to,
    },
    yamlSource: raw.yaml_source,
  };
}

function toRequestBody(req: PersonaCreateRequest): Record<string, unknown> {
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
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an IPersonaStore backed by the Ravn REST API.
 *
 * @param client - HTTP client scoped to the Ravn base path (e.g. /api/v1/ravn).
 */
export function buildRavnPersonaAdapter(client: ApiClient): IPersonaStore {
  return {
    async listPersonas(filter: PersonaFilter = 'all') {
      const raw = await client.get<RawPersonaSummary[]>(`/personas?source=${filter}`);
      return raw.map(toSummary);
    },

    async getPersona(name: string) {
      const raw = await client.get<RawPersonaDetail>(`/personas/${encodeURIComponent(name)}`);
      return toDetail(raw);
    },

    async getPersonaYaml(name: string) {
      return client.get<string>(`/personas/${encodeURIComponent(name)}/yaml`);
    },

    async createPersona(req: PersonaCreateRequest) {
      const raw = await client.post<RawPersonaDetail>('/personas', toRequestBody(req));
      return toDetail(raw);
    },

    async updatePersona(name: string, req: PersonaCreateRequest) {
      const raw = await client.put<RawPersonaDetail>(
        `/personas/${encodeURIComponent(name)}`,
        toRequestBody(req),
      );
      return toDetail(raw);
    },

    async deletePersona(name: string) {
      await client.delete<void>(`/personas/${encodeURIComponent(name)}`);
    },

    async forkPersona(name: string, req: PersonaForkRequest) {
      const raw = await client.post<RawPersonaDetail>(
        `/personas/${encodeURIComponent(name)}/fork`,
        { new_name: req.newName },
      );
      return toDetail(raw);
    },
  };
}
