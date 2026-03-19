import { describe, it, expect } from 'vitest';
import { serializePresetYaml, parsePresetYaml } from './presetYaml';
import type { PresetRuntimeFields } from './presetYaml';

const fullFields: PresetRuntimeFields = {
  cliTool: 'claude',
  workloadType: 'coding',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
  resourceConfig: { cpu: '2', memory: '4Gi' },
  mcpServers: [
    { name: 'linear', type: 'sse', url: 'https://linear.example.com/mcp' },
    { name: 'git', type: 'stdio', command: 'git-mcp', args: ['--verbose'] },
  ],
  terminalSidecar: {
    enabled: true,
    allowedCommands: ['npm', 'git'],
  },
  skills: [{ name: 'code-review', path: '/skills/review.md' }],
  rules: [{ inline: 'Always use TypeScript.' }],
  envVars: { NODE_ENV: 'development', DEBUG: 'true' },
  envSecretRefs: ['GITHUB_TOKEN', 'LINEAR_API_KEY'],
  source: { type: 'git', repo: 'github.com/org/repo', branch: 'main' },
  integrationIds: ['integ-1'],
  setupScripts: ['npm install'],
  workloadConfig: { timeout: 3600 },
};

const minimalFields: PresetRuntimeFields = {
  cliTool: 'claude',
  workloadType: 'coding',
  model: '',
  systemPrompt: '',
  resourceConfig: {},
  mcpServers: [],
  terminalSidecar: { enabled: false, allowedCommands: [] },
  skills: [],
  rules: [],
  envVars: {},
  envSecretRefs: [],
  source: null,
  integrationIds: [],
  setupScripts: [],
  workloadConfig: {},
};

describe('serializePresetYaml', () => {
  it('serializes full fields to YAML with snake_case keys', () => {
    const yaml = serializePresetYaml(fullFields);
    expect(yaml).toContain('cli_tool: claude');
    expect(yaml).toContain('workload_type: coding');
    expect(yaml).toContain('model: claude-sonnet-4-20250514');
    expect(yaml).toContain('system_prompt: You are a helpful assistant.');
    expect(yaml).toContain('resource_config:');
    expect(yaml).toContain("cpu: '2'");
    expect(yaml).toContain('mcp_servers:');
    expect(yaml).toContain('name: linear');
    expect(yaml).toContain('url: https://linear.example.com/mcp');
    expect(yaml).toContain('name: git');
    expect(yaml).toContain('command: git-mcp');
    expect(yaml).toContain('args:');
    expect(yaml).toContain('terminal_sidecar:');
    expect(yaml).toContain('enabled: true');
    expect(yaml).toContain('allowed_commands:');
    expect(yaml).toContain('skills:');
    expect(yaml).toContain('rules:');
    expect(yaml).toContain('env_vars:');
    expect(yaml).toContain('NODE_ENV: development');
    expect(yaml).toContain('env_secret_refs:');
    expect(yaml).toContain('GITHUB_TOKEN');
    expect(yaml).toContain('workload_config:');
    expect(yaml).toContain('timeout: 3600');
  });

  it('omits empty arrays and objects', () => {
    const yaml = serializePresetYaml(minimalFields);
    expect(yaml).not.toContain('mcp_servers');
    expect(yaml).not.toContain('skills');
    expect(yaml).not.toContain('rules');
    expect(yaml).not.toContain('env_vars');
    expect(yaml).not.toContain('env_secret_refs');
    expect(yaml).not.toContain('resource_config');
    expect(yaml).not.toContain('workload_config');
  });

  it('serializes null model and system_prompt when empty', () => {
    const yaml = serializePresetYaml(minimalFields);
    expect(yaml).toContain('model: null');
    expect(yaml).toContain('system_prompt: null');
  });
});

describe('parsePresetYaml', () => {
  it('round-trips full fields through serialize/parse', () => {
    const yaml = serializePresetYaml(fullFields);
    const parsed = parsePresetYaml(yaml);

    expect(parsed.cliTool).toBe('claude');
    expect(parsed.workloadType).toBe('coding');
    expect(parsed.model).toBe('claude-sonnet-4-20250514');
    expect(parsed.systemPrompt).toBe('You are a helpful assistant.');
    expect(parsed.resourceConfig).toEqual({ cpu: '2', memory: '4Gi' });
    expect(parsed.mcpServers).toHaveLength(2);
    expect(parsed.mcpServers![0].name).toBe('linear');
    expect(parsed.mcpServers![0].type).toBe('sse');
    expect(parsed.mcpServers![0].url).toBe('https://linear.example.com/mcp');
    expect(parsed.mcpServers![1].name).toBe('git');
    expect(parsed.mcpServers![1].command).toBe('git-mcp');
    expect(parsed.mcpServers![1].args).toEqual(['--verbose']);
    expect(parsed.terminalSidecar).toEqual({
      enabled: true,
      allowedCommands: ['npm', 'git'],
    });
    expect(parsed.skills).toEqual([{ name: 'code-review', path: '/skills/review.md' }]);
    expect(parsed.rules).toEqual([{ inline: 'Always use TypeScript.' }]);
    expect(parsed.envVars).toEqual({ NODE_ENV: 'development', DEBUG: 'true' });
    expect(parsed.envSecretRefs).toEqual(['GITHUB_TOKEN', 'LINEAR_API_KEY']);
    expect(parsed.workloadConfig).toEqual({ timeout: 3600 });
  });

  it('returns empty object for empty/null YAML', () => {
    expect(parsePresetYaml('')).toEqual({});
    expect(parsePresetYaml('null')).toEqual({});
  });

  it('returns empty object for non-object YAML', () => {
    expect(parsePresetYaml('42')).toEqual({});
    expect(parsePresetYaml('"just a string"')).toEqual({});
  });

  it('handles partial YAML with only some fields', () => {
    const yaml = 'cli_tool: codex\nmodel: gpt-4o\n';
    const parsed = parsePresetYaml(yaml);
    expect(parsed.cliTool).toBe('codex');
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.envVars).toBeUndefined();
  });

  it('handles null model and system_prompt', () => {
    const yaml = 'model: null\nsystem_prompt: null\n';
    const parsed = parsePresetYaml(yaml);
    expect(parsed.model).toBe('');
    expect(parsed.systemPrompt).toBe('');
  });

  it('handles terminal_sidecar without allowed_commands', () => {
    const yaml = 'terminal_sidecar:\n  enabled: true\n';
    const parsed = parsePresetYaml(yaml);
    expect(parsed.terminalSidecar).toEqual({ enabled: true, allowedCommands: [] });
  });
});
