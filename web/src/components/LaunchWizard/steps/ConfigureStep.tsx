import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Cpu,
  Plus,
  X,
  Server,
  Terminal,
  Shield,
  FileText,
  Settings2,
  Layers,
  Code2,
  Save,
  HardDrive,
  KeyRound,
  Plug,
  HardDriveDownload,
  Trash2,
} from 'lucide-react';
import { cn } from '@/utils';
import { serializePresetYaml, parsePresetYaml } from '@/utils/presetYaml';
import type {
  VolundrPreset,
  VolundrRepo,
  VolundrModel,
  McpServerConfig,
  McpServerType,
  CliTool,
  LinearIssue,
  RepoProvider,
  VolundrWorkspace,
  StoredCredential,
  IntegrationConnection,
} from '@/models';
import type { SourceType } from '../LaunchWizard';
import type { IVolundrService } from '@/ports';
import { LinearIssueSearch } from '@/components';
import type { WizardState } from '../LaunchWizard';
import styles from './ConfigureStep.module.css';

export interface ConfigureStepProps {
  state: WizardState;
  presets: VolundrPreset[];
  repos: VolundrRepo[];
  models: Record<string, VolundrModel>;
  availableMcpServers: McpServerConfig[];
  availableSecrets: string[];
  service: IVolundrService;
  searchLinearIssues?: (query: string) => Promise<LinearIssue[]>;
  localMountsEnabled?: boolean;
  onChange: (updates: Partial<WizardState>) => void;
  onSavePreset: (
    preset: Omit<VolundrPreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<VolundrPreset>;
}

const CLI_TOOLS: { value: CliTool; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Anthropic Claude CLI agent' },
  { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI agent' },
];

const PROVIDER_LABELS: Record<RepoProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export function ConfigureStep({
  state,
  presets,
  repos,
  models,
  availableMcpServers,
  availableSecrets,
  service,
  searchLinearIssues,
  localMountsEnabled = false,
  onChange,
  onSavePreset,
}: ConfigureStepProps) {
  const [workspaces, setWorkspaces] = useState<VolundrWorkspace[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [showMcpPicker, setShowMcpPicker] = useState(false);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [customMcpName, setCustomMcpName] = useState('');
  const [customMcpType, setCustomMcpType] = useState<McpServerType>('stdio');
  const [customMcpCommand, setCustomMcpCommand] = useState('');
  const [customMcpArgs, setCustomMcpArgs] = useState('');
  const [customMcpUrl, setCustomMcpUrl] = useState('');
  const [customMcpEnvKey, setCustomMcpEnvKey] = useState('');
  const [customMcpEnvVal, setCustomMcpEnvVal] = useState('');
  const [customMcpEnv, setCustomMcpEnv] = useState<Record<string, string>>({});
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');

  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);

  useEffect(() => {
    service
      .listWorkspaces('archived')
      .then(setWorkspaces)
      .catch(() => {});
    service
      .getCredentials()
      .then(setCredentials)
      .catch(() => {});
    service
      .getIntegrations()
      .then(setIntegrations)
      .catch(() => {});
  }, [service]);

  // Merge availableSecrets and stored credentials into a unified list
  const allCredentials = useMemo(() => {
    const credentialNames = new Set(credentials.map(c => c.name));
    const secretOnlyItems = availableSecrets
      .filter(s => !credentialNames.has(s))
      .map(s => ({ name: s, source: 'secret' as const }));
    const credItems = credentials.map(c => ({ name: c.name, source: 'credential' as const }));
    return [...credItems, ...secretOnlyItems];
  }, [credentials, availableSecrets]);

  const selectedWorkspace = workspaces.find(ws => ws.id === state.workspaceId);

  const currentRepo = repos.find(r => r.cloneUrl === state.repo);
  const branches = currentRepo?.branches ?? [];

  const reposByProvider = useMemo(
    () =>
      repos.reduce<Record<RepoProvider, VolundrRepo[]>>(
        (acc, repo) => {
          acc[repo.provider] = acc[repo.provider] || [];
          acc[repo.provider].push(repo);
          return acc;
        },
        {} as Record<RepoProvider, VolundrRepo[]>
      ),
    [repos]
  );

  // Filter models based on CLI tool
  const filteredModels = useMemo(() => {
    return Object.entries(models);
  }, [models]);

  const handleRepoChange = useCallback(
    (cloneUrl: string) => {
      const repo = repos.find(r => r.cloneUrl === cloneUrl);
      onChange({ repo: cloneUrl, branch: repo?.defaultBranch ?? '' });
    },
    [repos, onChange]
  );

  const handlePresetSelect = useCallback(
    (presetId: string) => {
      if (!presetId) {
        onChange({ preset: null });
        return;
      }
      const preset = presets.find(p => p.id === presetId);
      if (!preset) {
        return;
      }
      onChange({
        preset,
        model: preset.model ?? '',
        taskType: `skuld-${preset.cliTool}`,
        systemPrompt: preset.systemPrompt ?? '',
        mcpServers: [...preset.mcpServers],
        resourceConfig: { ...preset.resourceConfig },
        envVars: { ...preset.envVars },
        selectedCredentials: [...preset.envSecretRefs],
        template: {
          ...state.template,
          cliTool: preset.cliTool,
          workloadType: preset.workloadType,
          terminalSidecar: { ...preset.terminalSidecar },
          skills: [...preset.skills],
          rules: [...preset.rules],
          workloadConfig: { ...preset.workloadConfig },
        },
      });
    },
    [presets, state.template, onChange]
  );

  const handleToggleYaml = useCallback(() => {
    if (!state.yamlMode) {
      // Switching to YAML mode: serialize current state
      const yamlContent = serializePresetYaml({
        cliTool: state.template.cliTool,
        workloadType: state.template.workloadType,
        model: state.model,
        systemPrompt: state.systemPrompt,
        resourceConfig: state.resourceConfig,
        mcpServers: state.mcpServers,
        terminalSidecar: state.template.terminalSidecar,
        skills: state.template.skills,
        rules: state.template.rules,
        envVars: state.envVars,
        envSecretRefs: state.selectedCredentials,
        workloadConfig: state.template.workloadConfig,
      });
      onChange({ yamlMode: true, yamlContent });
      setYamlError(null);
      return;
    }

    // Switching back to form mode: parse YAML
    try {
      const parsed = parsePresetYaml(state.yamlContent);
      const updates: Partial<WizardState> = { yamlMode: false };
      if (parsed.model !== undefined) updates.model = parsed.model;
      if (parsed.systemPrompt !== undefined) updates.systemPrompt = parsed.systemPrompt;
      if (parsed.mcpServers) updates.mcpServers = parsed.mcpServers;
      if (parsed.resourceConfig) updates.resourceConfig = parsed.resourceConfig;
      if (parsed.envVars) updates.envVars = parsed.envVars;
      if (parsed.envSecretRefs) updates.selectedCredentials = parsed.envSecretRefs;

      // Template-nested fields
      const templateUpdates = { ...state.template };
      if (parsed.cliTool) templateUpdates.cliTool = parsed.cliTool;
      if (parsed.workloadType) templateUpdates.workloadType = parsed.workloadType;
      if (parsed.terminalSidecar) templateUpdates.terminalSidecar = parsed.terminalSidecar;
      if (parsed.skills) templateUpdates.skills = parsed.skills;
      if (parsed.rules) templateUpdates.rules = parsed.rules;
      if (parsed.workloadConfig) templateUpdates.workloadConfig = parsed.workloadConfig;
      updates.template = templateUpdates;

      onChange(updates);
      setYamlError(null);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'Invalid YAML');
    }
  }, [state, onChange]);

  const handleLinearSelect = useCallback(
    (issue: LinearIssue) => {
      const updates: Partial<WizardState> = { linearIssue: issue };
      if (!state.name) {
        updates.name = issue.identifier;
      }
      onChange(updates);
    },
    [state.name, onChange]
  );

  const handleLinearClear = useCallback(() => {
    onChange({ linearIssue: undefined });
  }, [onChange]);

  // MCP server management
  const handleAddMcpServer = useCallback(
    (server: McpServerConfig) => {
      if (state.mcpServers.some(s => s.name === server.name)) {
        return;
      }
      onChange({ mcpServers: [...state.mcpServers, server] });
    },
    [state.mcpServers, onChange]
  );

  const handleRemoveMcpServer = useCallback(
    (name: string) => {
      onChange({ mcpServers: state.mcpServers.filter(s => s.name !== name) });
    },
    [state.mcpServers, onChange]
  );

  const resetMcpForm = useCallback(() => {
    setCustomMcpName('');
    setCustomMcpType('stdio');
    setCustomMcpCommand('');
    setCustomMcpArgs('');
    setCustomMcpUrl('');
    setCustomMcpEnvKey('');
    setCustomMcpEnvVal('');
    setCustomMcpEnv({});
    setShowMcpForm(false);
    setShowMcpPicker(false);
  }, []);

  const handleAddCustomMcp = useCallback(() => {
    if (!customMcpName.trim()) {
      return;
    }
    const server: McpServerConfig = {
      name: customMcpName.trim(),
      type: customMcpType,
    };
    if (customMcpType === 'stdio') {
      server.command = customMcpCommand.trim() || undefined;
      const args = customMcpArgs.trim();
      if (args) {
        server.args = args.split(/\s+/);
      }
    } else {
      server.url = customMcpUrl.trim() || undefined;
    }
    if (Object.keys(customMcpEnv).length > 0) {
      server.env = { ...customMcpEnv };
    }
    handleAddMcpServer(server);
    resetMcpForm();
  }, [
    customMcpName,
    customMcpType,
    customMcpCommand,
    customMcpArgs,
    customMcpUrl,
    customMcpEnv,
    handleAddMcpServer,
    resetMcpForm,
  ]);

  // Restrict terminal shell — implicitly enables the terminal sidecar
  const handleToggleTerminalRestricted = useCallback(() => {
    const nowRestricted = !state.terminalRestricted;
    onChange({
      terminalRestricted: nowRestricted,
      template: {
        ...state.template,
        terminalSidecar: {
          ...state.template.terminalSidecar,
          enabled: nowRestricted,
        },
      },
    });
  }, [state.template, state.terminalRestricted, onChange]);

  const handleAddAllowedCommand = useCallback(() => {
    onChange({
      template: {
        ...state.template,
        terminalSidecar: {
          ...state.template.terminalSidecar,
          allowedCommands: [...state.template.terminalSidecar.allowedCommands, ''],
        },
      },
    });
  }, [state.template, onChange]);

  const handleUpdateAllowedCommand = useCallback(
    (idx: number, value: string) => {
      const cmds = [...state.template.terminalSidecar.allowedCommands];
      cmds[idx] = value;
      onChange({
        template: {
          ...state.template,
          terminalSidecar: { ...state.template.terminalSidecar, allowedCommands: cmds },
        },
      });
    },
    [state.template, onChange]
  );

  const handleRemoveAllowedCommand = useCallback(
    (idx: number) => {
      const cmds = state.template.terminalSidecar.allowedCommands.filter((_, i) => i !== idx);
      onChange({
        template: {
          ...state.template,
          terminalSidecar: { ...state.template.terminalSidecar, allowedCommands: cmds },
        },
      });
    },
    [state.template, onChange]
  );

  // Environment variables
  const handleAddEnvVar = useCallback(() => {
    if (!newEnvKey.trim()) {
      return;
    }
    onChange({ envVars: { ...state.envVars, [newEnvKey.trim()]: newEnvVal } });
    setNewEnvKey('');
    setNewEnvVal('');
  }, [newEnvKey, newEnvVal, state.envVars, onChange]);

  const handleRemoveEnvVar = useCallback(
    (key: string) => {
      const next = { ...state.envVars };
      delete next[key];
      onChange({ envVars: next });
    },
    [state.envVars, onChange]
  );

  // Credential selection
  const handleToggleCredential = useCallback(
    (name: string) => {
      if (state.selectedCredentials.includes(name)) {
        onChange({ selectedCredentials: state.selectedCredentials.filter(c => c !== name) });
      } else {
        onChange({ selectedCredentials: [...state.selectedCredentials, name] });
      }
    },
    [state.selectedCredentials, onChange]
  );

  // Integration selection
  const handleToggleIntegration = useCallback(
    (id: string) => {
      if (state.selectedIntegrations.includes(id)) {
        onChange({ selectedIntegrations: state.selectedIntegrations.filter(i => i !== id) });
      } else {
        onChange({ selectedIntegrations: [...state.selectedIntegrations, id] });
      }
    },
    [state.selectedIntegrations, onChange]
  );

  // Save as preset
  const handleSavePreset = useCallback(async () => {
    if (!savePresetName.trim()) {
      return;
    }
    setIsSavingPreset(true);
    try {
      const saved = await onSavePreset({
        name: savePresetName.trim(),
        description: '',
        isDefault: false,
        cliTool: state.template.cliTool,
        workloadType: state.template.workloadType,
        model: state.model || null,
        systemPrompt: state.systemPrompt || null,
        resourceConfig: state.resourceConfig,
        mcpServers: state.mcpServers,
        terminalSidecar: state.template.terminalSidecar,
        skills: state.template.skills,
        rules: state.template.rules,
        envVars: state.envVars,
        envSecretRefs: state.selectedCredentials,
        workloadConfig: state.template.workloadConfig,
      });
      onChange({ preset: saved });
      setSavePresetName('');
      setShowSavePreset(false);
    } finally {
      setIsSavingPreset(false);
    }
  }, [savePresetName, state, onSavePreset, onChange]);

  // Setup scripts
  const handleAddScript = useCallback(() => {
    onChange({ setupScripts: [...state.setupScripts, ''] });
  }, [state.setupScripts, onChange]);

  const handleUpdateScript = useCallback(
    (idx: number, value: string) => {
      const scripts = [...state.setupScripts];
      scripts[idx] = value;
      onChange({ setupScripts: scripts });
    },
    [state.setupScripts, onChange]
  );

  const handleRemoveScript = useCallback(
    (idx: number) => {
      onChange({ setupScripts: state.setupScripts.filter((_, i) => i !== idx) });
    },
    [state.setupScripts, onChange]
  );

  return (
    <div className={styles.container}>
      {/* Preset selector */}
      {presets.length > 0 && (
        <div className={styles.presetSection}>
          <label className={styles.formLabel}>
            <Layers className={styles.formLabelIcon} />
            Load Preset
          </label>
          <select
            className={styles.formSelect}
            value={state.preset?.id ?? ''}
            onChange={e => handlePresetSelect(e.target.value)}
          >
            <option value="">Custom (no preset)</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
                {preset.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          {state.preset && (
            <span className={styles.presetDescription}>{state.preset.description}</span>
          )}
        </div>
      )}

      {/* CLI Tool selector */}
      <div className={styles.cliToolSection}>
        <span className={styles.sectionLabel}>CLI Tool</span>
        <div className={styles.cliToolGrid}>
          {CLI_TOOLS.map(tool => (
            <button
              key={tool.value}
              className={cn(
                styles.cliToolCard,
                state.template.cliTool === tool.value && styles.cliToolCardActive
              )}
              onClick={() =>
                onChange({
                  taskType: `skuld-${tool.value}`,
                  template: { ...state.template, cliTool: tool.value },
                })
              }
              type="button"
            >
              <span className={styles.cliToolLabel}>{tool.label}</span>
              <span className={styles.cliToolDescription}>{tool.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Basic Fields */}
      <div className={styles.formSection}>
        {/* Session Name */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            <Terminal className={styles.formLabelIcon} />
            Session Name
            <span className={styles.required}>*</span>
          </label>
          <input
            className={styles.formInput}
            type="text"
            placeholder="e.g. feature-auth-refactor"
            value={state.name}
            onChange={e => onChange({ name: e.target.value })}
            required
          />
        </div>

        {/* Linear Issue */}
        {searchLinearIssues && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Linear Issue</label>
            <LinearIssueSearch
              onSelect={handleLinearSelect}
              onClear={handleLinearClear}
              selectedIssue={state.linearIssue ?? null}
              onSearch={searchLinearIssues}
            />
          </div>
        )}

        {/* Source Type Toggle — only show when local mounts are enabled */}
        {localMountsEnabled && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Workspace Source
              <span className={styles.required}>*</span>
            </label>
            <div className={styles.sourceTypeToggle}>
              <button
                type="button"
                className={cn(styles.sourceTypeButton, state.sourceType === 'git' && styles.sourceTypeActive)}
                onClick={() => onChange({ sourceType: 'git' as SourceType })}
              >
                <FolderGit2 className={styles.formLabelIcon} />
                Git Repository
              </button>
              <button
                type="button"
                className={cn(styles.sourceTypeButton, state.sourceType === 'local_mount' && styles.sourceTypeActive)}
                onClick={() => onChange({ sourceType: 'local_mount' as SourceType })}
              >
                <HardDriveDownload className={styles.formLabelIcon} />
                Local Mount
              </button>
            </div>
          </div>
        )}

        {state.sourceType === 'git' && (
          <>
            {/* Repository */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <FolderGit2 className={styles.formLabelIcon} />
                Repository
                <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.formSelect}
                value={state.repo}
                onChange={e => handleRepoChange(e.target.value)}
              >
                <option value="">Select repository...</option>
                {Object.entries(reposByProvider).map(([provider, providerRepos]) => (
                  <optgroup key={provider} label={PROVIDER_LABELS[provider as RepoProvider]}>
                    {providerRepos.map(repo => (
                      <option key={repo.cloneUrl} value={repo.cloneUrl}>
                        {repo.org}/{repo.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Branch */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Branch
                <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.formSelect}
                value={state.branch}
                onChange={e => onChange({ branch: e.target.value })}
                disabled={!state.repo}
              >
                <option value="">Select branch...</option>
                {branches.map(branch => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {state.sourceType === 'local_mount' && (
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              <HardDriveDownload className={styles.formLabelIcon} />
              Mount Paths
              <span className={styles.required}>*</span>
            </label>
            <div className={styles.mountEditor}>
              {state.mountPaths.map((mapping, idx) => (
                <div key={idx} className={styles.mountRow}>
                  <input
                    className={styles.formInput}
                    type="text"
                    placeholder="Host path (e.g. /home/user/project)"
                    value={mapping.host_path}
                    onChange={e => {
                      const updated = [...state.mountPaths];
                      updated[idx] = { ...mapping, host_path: e.target.value };
                      onChange({ mountPaths: updated });
                    }}
                  />
                  <input
                    className={styles.formInput}
                    type="text"
                    placeholder="Container path (e.g. /workspace)"
                    value={mapping.mount_path}
                    onChange={e => {
                      const updated = [...state.mountPaths];
                      updated[idx] = { ...mapping, mount_path: e.target.value };
                      onChange({ mountPaths: updated });
                    }}
                  />
                  <label className={styles.mountReadOnly}>
                    <input
                      type="checkbox"
                      checked={mapping.read_only}
                      onChange={e => {
                        const updated = [...state.mountPaths];
                        updated[idx] = { ...mapping, read_only: e.target.checked };
                        onChange({ mountPaths: updated });
                      }}
                    />
                    Read-only
                  </label>
                  {state.mountPaths.length > 1 && (
                    <button
                      type="button"
                      className={styles.mountRemoveButton}
                      onClick={() => {
                        const updated = state.mountPaths.filter((_, i) => i !== idx);
                        onChange({ mountPaths: updated });
                      }}
                    >
                      <Trash2 className={styles.buttonIcon} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className={styles.addMountButton}
                onClick={() =>
                  onChange({
                    mountPaths: [
                      ...state.mountPaths,
                      { host_path: '', mount_path: '', read_only: true },
                    ],
                  })
                }
              >
                <Plus className={styles.buttonIcon} />
                Add mount
              </button>
            </div>
          </div>
        )}

        {/* Model */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            <Cpu className={styles.formLabelIcon} />
            Model
            <span className={styles.required}>*</span>
          </label>
          <select
            className={styles.formSelect}
            value={state.model}
            onChange={e => onChange({ model: e.target.value })}
          >
            <option value="">Select model...</option>
            {filteredModels.map(([key, model]) => (
              <option key={key} value={key}>
                {model.provider === 'local' ? '⚡ ' : '☁ '}
                {model.name} ({model.tier})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Workspace */}
      {workspaces.length > 0 && (
        <div className={styles.formSection}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              <HardDrive className={styles.formLabelIcon} />
              Workspace
            </label>
            <select
              className={styles.formSelect}
              value={state.workspaceId || ''}
              onChange={e => onChange({ workspaceId: e.target.value || undefined })}
            >
              <option value="">New workspace</option>
              {workspaces.map(ws => (
                <option key={ws.id} value={ws.id}>
                  {ws.pvcName} ({ws.sizeGb}Gi) — archived{' '}
                  {new Date(ws.archivedAt || ws.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
            {selectedWorkspace && (
              <div className={styles.workspaceInfo}>
                PVC: {selectedWorkspace.pvcName} · {selectedWorkspace.sizeGb}Gi · archived{' '}
                {new Date(
                  selectedWorkspace.archivedAt || selectedWorkspace.createdAt
                ).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Advanced Section */}
      <div className={styles.advancedSection}>
        <div className={styles.advancedHeader}>
          <button
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced(prev => !prev)}
            type="button"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? (
              <ChevronDown className={styles.advancedChevron} />
            ) : (
              <ChevronRight className={styles.advancedChevron} />
            )}
            <Settings2 className={styles.advancedIcon} />
            Advanced Configuration
          </button>

          {showAdvanced && (
            <button className={styles.yamlToggle} onClick={handleToggleYaml} type="button">
              <Code2 className={styles.yamlToggleIcon} />
              {state.yamlMode ? 'Form View' : 'Edit as YAML'}
            </button>
          )}
        </div>

        {showAdvanced && state.yamlMode && (
          <div className={styles.yamlSection}>
            <textarea
              className={styles.yamlEditor}
              value={state.yamlContent}
              onChange={e => onChange({ yamlContent: e.target.value })}
              spellCheck={false}
              rows={20}
            />
            {yamlError && <span className={styles.yamlError}>{yamlError}</span>}
          </div>
        )}

        {showAdvanced && !state.yamlMode && (
          <div className={styles.advancedContent}>
            {/* System Prompt */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <FileText className={styles.formLabelIcon} />
                System Prompt
              </label>
              <textarea
                className={styles.formTextarea}
                value={state.systemPrompt}
                onChange={e => onChange({ systemPrompt: e.target.value })}
                placeholder="Optional system prompt..."
                rows={4}
              />
            </div>

            {/* MCP Servers */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <Server className={styles.formLabelIcon} />
                MCP Servers
              </label>

              {state.mcpServers.length > 0 && (
                <div className={styles.itemList}>
                  {state.mcpServers.map(server => (
                    <div key={server.name} className={styles.mcpCard}>
                      <div className={styles.mcpCardHeader}>
                        <span className={styles.listItemText}>
                          <Server className={styles.listItemIcon} />
                          {server.name}
                          <span className={styles.mcpTypeBadge}>{server.type}</span>
                        </span>
                        <button
                          className={styles.removeButton}
                          onClick={() => handleRemoveMcpServer(server.name)}
                          type="button"
                          aria-label={`Remove ${server.name}`}
                        >
                          <X className={styles.removeIcon} />
                        </button>
                      </div>
                      {server.type === 'stdio' && server.command && (
                        <span className={styles.listItemMeta}>
                          {server.command}
                          {server.args && server.args.length > 0 && ` ${server.args.join(' ')}`}
                        </span>
                      )}
                      {(server.type === 'sse' || server.type === 'http') && server.url && (
                        <span className={styles.listItemMeta}>{server.url}</span>
                      )}
                      {server.env && Object.keys(server.env).length > 0 && (
                        <span className={styles.listItemMeta}>
                          {Object.keys(server.env).length} env var(s)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {showMcpPicker && !showMcpForm && (
                <div className={styles.pickerPanel}>
                  <div className={styles.pickerList}>
                    {availableMcpServers
                      .filter(s => !state.mcpServers.some(ms => ms.name === s.name))
                      .map(server => (
                        <button
                          key={server.name}
                          className={styles.pickerItem}
                          onClick={() => handleAddMcpServer(server)}
                          type="button"
                        >
                          <Server className={styles.pickerItemIcon} />
                          {server.name}
                          <span className={styles.mcpTypeBadge}>{server.type}</span>
                        </button>
                      ))}
                  </div>
                  <div className={styles.pickerActions}>
                    <button
                      className={styles.smallButton}
                      onClick={() => setShowMcpForm(true)}
                      type="button"
                    >
                      <Plus className={styles.addIcon} />
                      Add Custom
                    </button>
                    <button
                      className={styles.smallButtonMuted}
                      onClick={resetMcpForm}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {showMcpForm && (
                <div className={styles.pickerPanel}>
                  <div className={styles.pickerCustom}>
                    <input
                      className={styles.formInput}
                      placeholder="Server name (required)"
                      value={customMcpName}
                      onChange={e => setCustomMcpName(e.target.value)}
                    />

                    <div className={styles.mcpTypeGroup}>
                      {(['stdio', 'sse', 'http'] as const).map(t => (
                        <button
                          key={t}
                          className={cn(
                            styles.mcpTypeButton,
                            customMcpType === t && styles.mcpTypeButtonActive
                          )}
                          onClick={() => setCustomMcpType(t)}
                          type="button"
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {customMcpType === 'stdio' && (
                      <>
                        <input
                          className={styles.formInput}
                          placeholder="Command (e.g. mcp-server-github)"
                          value={customMcpCommand}
                          onChange={e => setCustomMcpCommand(e.target.value)}
                        />
                        <input
                          className={styles.formInput}
                          placeholder="Args (space-separated)"
                          value={customMcpArgs}
                          onChange={e => setCustomMcpArgs(e.target.value)}
                        />
                      </>
                    )}

                    {(customMcpType === 'sse' || customMcpType === 'http') && (
                      <input
                        className={styles.formInput}
                        placeholder="URL (e.g. http://localhost:3000/sse)"
                        value={customMcpUrl}
                        onChange={e => setCustomMcpUrl(e.target.value)}
                      />
                    )}

                    {/* Environment Variables */}
                    <span className={styles.nestedLabel}>Environment Variables</span>
                    {Object.entries(customMcpEnv).length > 0 && (
                      <div className={styles.itemList}>
                        {Object.entries(customMcpEnv).map(([key, val]) => (
                          <div key={key} className={styles.listItem}>
                            <span className={styles.envPair}>
                              <span className={styles.envKey}>{key}</span>
                              <span className={styles.envVal}>{val}</span>
                            </span>
                            <button
                              className={styles.removeButton}
                              onClick={() => {
                                const next = { ...customMcpEnv };
                                delete next[key];
                                setCustomMcpEnv(next);
                              }}
                              type="button"
                              aria-label={`Remove ${key}`}
                            >
                              <X className={styles.removeIcon} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.addEnvRow}>
                      <input
                        className={styles.formInput}
                        placeholder="Key"
                        value={customMcpEnvKey}
                        onChange={e => setCustomMcpEnvKey(e.target.value)}
                      />
                      <input
                        className={styles.formInput}
                        placeholder="Value"
                        value={customMcpEnvVal}
                        onChange={e => setCustomMcpEnvVal(e.target.value)}
                      />
                      <button
                        className={styles.smallButton}
                        onClick={() => {
                          if (customMcpEnvKey.trim()) {
                            setCustomMcpEnv(prev => ({
                              ...prev,
                              [customMcpEnvKey.trim()]: customMcpEnvVal,
                            }));
                            setCustomMcpEnvKey('');
                            setCustomMcpEnvVal('');
                          }
                        }}
                        type="button"
                        disabled={!customMcpEnvKey.trim()}
                      >
                        Add
                      </button>
                    </div>

                    <div className={styles.pickerActions}>
                      <button
                        className={styles.smallButton}
                        onClick={handleAddCustomMcp}
                        type="button"
                        disabled={!customMcpName.trim()}
                      >
                        Add Server
                      </button>
                      <button
                        className={styles.smallButtonMuted}
                        onClick={resetMcpForm}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!showMcpPicker && !showMcpForm && (
                <button
                  className={styles.addButton}
                  onClick={() => setShowMcpPicker(true)}
                  type="button"
                >
                  <Plus className={styles.addIcon} />
                  Add MCP Server
                </button>
              )}
            </div>

            {/* Restrict Terminal Shell */}
            <div className={styles.formGroup}>
              <div className={styles.toggleRow}>
                <label className={styles.formLabel}>
                  <Shield className={styles.formLabelIcon} />
                  Restrict terminal shell
                </label>
                <button
                  className={cn(styles.toggle, state.terminalRestricted && styles.toggleActive)}
                  onClick={handleToggleTerminalRestricted}
                  type="button"
                  role="switch"
                  aria-checked={state.terminalRestricted}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
              <span className={styles.terminalRestrictedHint}>
                When enabled, the session terminal is restricted to allowed commands only
              </span>

              {state.terminalRestricted && (
                <div className={styles.nestedSection}>
                  <span className={styles.nestedLabel}>Allowed Commands</span>
                  {state.template.terminalSidecar.allowedCommands.map((cmd, idx) => (
                    <div key={idx} className={styles.listRow}>
                      <input
                        className={styles.formInput}
                        value={cmd}
                        onChange={e => handleUpdateAllowedCommand(idx, e.target.value)}
                        placeholder="e.g. npm test"
                      />
                      <button
                        className={styles.removeButton}
                        onClick={() => handleRemoveAllowedCommand(idx)}
                        type="button"
                        aria-label="Remove command"
                      >
                        <X className={styles.removeIcon} />
                      </button>
                    </div>
                  ))}
                  <button
                    className={styles.addButton}
                    onClick={handleAddAllowedCommand}
                    type="button"
                  >
                    <Plus className={styles.addIcon} />
                    Add Command
                  </button>
                </div>
              )}
            </div>

            {/* Resource Config */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Resources</label>
              <div className={styles.resourceGrid}>
                <div className={styles.resourceField}>
                  <label className={styles.resourceLabel}>CPU</label>
                  <input
                    className={styles.formInput}
                    value={state.resourceConfig.cpu ?? ''}
                    onChange={e =>
                      onChange({
                        resourceConfig: {
                          ...state.resourceConfig,
                          cpu: e.target.value || undefined,
                        },
                      })
                    }
                    placeholder="e.g. 4"
                  />
                </div>
                <div className={styles.resourceField}>
                  <label className={styles.resourceLabel}>Memory</label>
                  <input
                    className={styles.formInput}
                    value={state.resourceConfig.memory ?? ''}
                    onChange={e =>
                      onChange({
                        resourceConfig: {
                          ...state.resourceConfig,
                          memory: e.target.value || undefined,
                        },
                      })
                    }
                    placeholder="e.g. 8Gi"
                  />
                </div>
                <div className={styles.resourceField}>
                  <label className={styles.resourceLabel}>GPU</label>
                  <input
                    className={styles.formInput}
                    value={state.resourceConfig.gpu ?? ''}
                    onChange={e =>
                      onChange({
                        resourceConfig: {
                          ...state.resourceConfig,
                          gpu: e.target.value || undefined,
                        },
                      })
                    }
                    placeholder="e.g. 1"
                  />
                </div>
              </div>
            </div>

            {/* Environment Variables */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Environment Variables</label>
              {Object.entries(state.envVars).length > 0 && (
                <div className={styles.itemList}>
                  {Object.entries(state.envVars).map(([key, val]) => (
                    <div key={key} className={styles.listItem}>
                      <span className={styles.envPair}>
                        <span className={styles.envKey}>{key}</span>
                        <span className={styles.envVal}>{val}</span>
                      </span>
                      <button
                        className={styles.removeButton}
                        onClick={() => handleRemoveEnvVar(key)}
                        type="button"
                        aria-label={`Remove ${key}`}
                      >
                        <X className={styles.removeIcon} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.addEnvRow}>
                <input
                  className={styles.formInput}
                  placeholder="Key"
                  value={newEnvKey}
                  onChange={e => setNewEnvKey(e.target.value)}
                />
                <input
                  className={styles.formInput}
                  placeholder="Value"
                  value={newEnvVal}
                  onChange={e => setNewEnvVal(e.target.value)}
                />
                <button
                  className={styles.smallButton}
                  onClick={handleAddEnvVar}
                  type="button"
                  disabled={!newEnvKey.trim()}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Credentials */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <KeyRound className={styles.formLabelIcon} />
                Credentials
              </label>
              {allCredentials.length > 0 ? (
                <div className={styles.secretGrid}>
                  {allCredentials.map(item => (
                    <label key={item.name} className={styles.secretItem}>
                      <input
                        type="checkbox"
                        checked={state.selectedCredentials.includes(item.name)}
                        onChange={() => handleToggleCredential(item.name)}
                        className={styles.secretCheckbox}
                      />
                      <span className={styles.secretName}>{item.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <span className={styles.emptyHint}>No credentials available</span>
              )}
            </div>

            {/* Integrations */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <Plug className={styles.formLabelIcon} />
                Select integrations
              </label>
              <span className={styles.formLabelHint}>
                Attach pre-configured integrations to this session
              </span>
              {integrations.filter(i => i.enabled).length > 0 ? (
                <div className={styles.secretGrid}>
                  {integrations
                    .filter(i => i.enabled)
                    .map(integ => (
                      <label key={integ.id} className={styles.secretItem}>
                        <input
                          type="checkbox"
                          checked={state.selectedIntegrations.includes(integ.id)}
                          onChange={() => handleToggleIntegration(integ.id)}
                          className={styles.secretCheckbox}
                        />
                        <span className={styles.secretName}>{integ.slug}</span>
                      </label>
                    ))}
                </div>
              ) : (
                <span className={styles.emptyHint}>
                  No integrations configured. Integrations are configured by your administrator.
                </span>
              )}
            </div>

            {/* Setup Scripts */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Setup Scripts</label>
              {state.setupScripts.map((script, idx) => (
                <div key={idx} className={styles.listRow}>
                  <input
                    className={styles.formInput}
                    value={script}
                    onChange={e => handleUpdateScript(idx, e.target.value)}
                    placeholder="e.g. npm install"
                  />
                  <button
                    className={styles.removeButton}
                    onClick={() => handleRemoveScript(idx)}
                    type="button"
                    aria-label="Remove script"
                  >
                    <X className={styles.removeIcon} />
                  </button>
                </div>
              ))}
              <button className={styles.addButton} onClick={handleAddScript} type="button">
                <Plus className={styles.addIcon} />
                Add Script
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save as Preset */}
      <div className={styles.savePresetSection}>
        {showSavePreset ? (
          <div className={styles.savePresetForm}>
            <input
              className={styles.formInput}
              placeholder="Preset name"
              value={savePresetName}
              onChange={e => setSavePresetName(e.target.value)}
            />
            <div className={styles.pickerActions}>
              <button
                className={styles.smallButton}
                onClick={handleSavePreset}
                type="button"
                disabled={!savePresetName.trim() || isSavingPreset}
              >
                {isSavingPreset ? 'Saving...' : 'Save'}
              </button>
              <button
                className={styles.smallButtonMuted}
                onClick={() => {
                  setShowSavePreset(false);
                  setSavePresetName('');
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className={styles.savePresetButton}
            onClick={() => setShowSavePreset(true)}
            type="button"
          >
            <Save className={styles.addIcon} />
            Save as Preset
          </button>
        )}
      </div>
    </div>
  );
}
