import yaml from 'js-yaml';
import type {
  CliTool,
  McpServerConfig,
  ResourceConfig,
  TerminalSidecarConfig,
  SkillConfig,
  RuleConfig,
  WorkloadConfig,
  SessionSource,
} from '@/models';

/**
 * Shape of the YAML document for a preset's runtime configuration.
 * This is the serialised form — snake_case keys match the API schema.
 */
interface PresetYamlDoc {
  cli_tool?: string;
  workload_type?: string;
  model?: string | null;
  system_prompt?: string | null;
  resource_config?: Record<string, string | undefined>;
  mcp_servers?: Array<{
    name: string;
    type: string;
    command?: string;
    url?: string;
    args?: string[];
  }>;
  terminal_sidecar?: { enabled: boolean; allowed_commands: string[] };
  skills?: Array<{ name: string; path?: string; inline?: string }>;
  rules?: Array<{ path?: string; inline?: string }>;
  env_vars?: Record<string, string>;
  env_secret_refs?: string[];
  source?: { type: 'git'; repo: string; branch: string } | { type: 'local_mount'; paths: Array<{ host_path: string; mount_path: string; read_only: boolean }> } | null;
  integration_ids?: string[];
  setup_scripts?: string[];
  workload_config?: Record<string, string | number | boolean | undefined>;
}

/**
 * Runtime fields extracted from a WizardState-like object.
 */
export interface PresetRuntimeFields {
  cliTool: CliTool;
  workloadType: string;
  model: string;
  systemPrompt: string;
  resourceConfig: ResourceConfig;
  mcpServers: McpServerConfig[];
  terminalSidecar: TerminalSidecarConfig;
  skills: SkillConfig[];
  rules: RuleConfig[];
  envVars: Record<string, string>;
  envSecretRefs: string[];
  source: SessionSource | null;
  integrationIds: string[];
  setupScripts: string[];
  workloadConfig: WorkloadConfig;
}

/**
 * Serialize runtime fields to YAML.
 */
export function serializePresetYaml(fields: PresetRuntimeFields): string {
  const doc: PresetYamlDoc = {
    cli_tool: fields.cliTool,
    workload_type: fields.workloadType,
    model: fields.model || null,
    system_prompt: fields.systemPrompt || null,
    resource_config:
      Object.keys(fields.resourceConfig).length > 0 ? fields.resourceConfig : undefined,
    mcp_servers:
      fields.mcpServers.length > 0
        ? fields.mcpServers.map(s => ({
            name: s.name,
            type: s.type,
            ...(s.command && { command: s.command }),
            ...(s.url && { url: s.url }),
            ...(s.args && s.args.length > 0 && { args: s.args }),
          }))
        : undefined,
    terminal_sidecar: {
      enabled: fields.terminalSidecar.enabled,
      allowed_commands: fields.terminalSidecar.allowedCommands,
    },
    skills: fields.skills.length > 0 ? fields.skills : undefined,
    rules: fields.rules.length > 0 ? fields.rules : undefined,
    env_vars: Object.keys(fields.envVars).length > 0 ? fields.envVars : undefined,
    env_secret_refs: fields.envSecretRefs.length > 0 ? fields.envSecretRefs : undefined,
    source: fields.source ?? undefined,
    integration_ids: fields.integrationIds.length > 0 ? fields.integrationIds : undefined,
    setup_scripts: fields.setupScripts.length > 0 ? fields.setupScripts : undefined,
    workload_config:
      Object.keys(fields.workloadConfig).length > 0 ? fields.workloadConfig : undefined,
  };

  // Remove undefined keys for cleaner YAML output
  const cleaned = JSON.parse(JSON.stringify(doc));
  return yaml.dump(cleaned, { lineWidth: 120, noRefs: true });
}

/**
 * Parse YAML back to runtime fields.
 * Returns only the fields that were present in the YAML.
 */
export function parsePresetYaml(yamlStr: string): Partial<PresetRuntimeFields> {
  const doc = yaml.load(yamlStr) as PresetYamlDoc | null;
  if (!doc || typeof doc !== 'object') {
    return {};
  }

  const result: Partial<PresetRuntimeFields> = {};

  if (doc.cli_tool) {
    result.cliTool = doc.cli_tool as CliTool;
  }
  if (doc.workload_type) {
    result.workloadType = doc.workload_type;
  }
  if (doc.model !== undefined) {
    result.model = doc.model ?? '';
  }
  if (doc.system_prompt !== undefined) {
    result.systemPrompt = doc.system_prompt ?? '';
  }
  if (doc.resource_config) {
    result.resourceConfig = doc.resource_config;
  }
  if (doc.mcp_servers) {
    result.mcpServers = doc.mcp_servers.map(s => ({
      name: s.name,
      type: s.type as McpServerConfig['type'],
      command: s.command,
      url: s.url,
      args: s.args,
    }));
  }
  if (doc.terminal_sidecar) {
    result.terminalSidecar = {
      enabled: doc.terminal_sidecar.enabled,
      allowedCommands: doc.terminal_sidecar.allowed_commands ?? [],
    };
  }
  if (doc.skills) {
    result.skills = doc.skills;
  }
  if (doc.rules) {
    result.rules = doc.rules;
  }
  if (doc.env_vars) {
    result.envVars = doc.env_vars;
  }
  if (doc.env_secret_refs) {
    result.envSecretRefs = doc.env_secret_refs;
  }
  if (doc.source !== undefined) {
    result.source = doc.source as SessionSource | null;
  }
  if (doc.integration_ids) {
    result.integrationIds = doc.integration_ids;
  }
  if (doc.setup_scripts) {
    result.setupScripts = doc.setup_scripts;
  }
  if (doc.workload_config) {
    result.workloadConfig = doc.workload_config;
  }

  return result;
}
