import { useMemo } from 'react';
import {
  Terminal,
  FolderGit2,
  Cpu,
  Server,
  FileText,
  Shield,
  Key,
  KeyRound,
  Plug,
  ScrollText,
  BookOpen,
  Layers,
  HardDrive,
} from 'lucide-react';
import type { VolundrModel, VolundrRepo } from '@/modules/volundr/models';
import { CLI_TOOL_LABELS } from '@/modules/volundr/models';
import { TrackerIssueBadge } from '@/modules/volundr/components/molecules/TrackerIssueBadge';
import type { WizardState } from '../LaunchWizard';
import styles from './ReviewStep.module.css';

export interface ReviewStepProps {
  state: WizardState;
  repos: VolundrRepo[];
  models: Record<string, VolundrModel>;
}

function isModified(current: unknown, original: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(original);
}

function truncatePrompt(prompt: string, lines: number = 2): string {
  const parts = prompt.split('\n').slice(0, lines);
  const truncated = parts.join('\n');
  if (prompt.split('\n').length > lines) {
    return truncated + '...';
  }
  return truncated;
}

export function ReviewStep({ state, repos, models }: ReviewStepProps) {
  const template = state.template;
  const preset = state.preset;
  const modelInfo = models[state.model];
  const currentRepo = repos.find(r => r.cloneUrl === state.repo);
  const isLocalMount = state.sourceType === 'local_mount';

  // Compare against loaded preset if available, otherwise against template
  const modifications = useMemo(() => {
    const refModel = preset?.model ?? template.model ?? '';
    const refMcpServers = preset?.mcpServers ?? template.mcpServers;
    const refResourceConfig = preset?.resourceConfig ?? template.resourceConfig;
    const refEnvVars = preset?.envVars ?? template.envVars;
    const refSystemPrompt = preset?.systemPrompt ?? template.systemPrompt ?? '';
    const refTerminalSidecar = preset?.terminalSidecar ?? template.terminalSidecar;
    const refCredentials = preset?.envSecretRefs ?? template.envSecretRefs;

    return {
      model: isModified(state.model, refModel),
      mcpServers: isModified(state.mcpServers, refMcpServers),
      resourceConfig: isModified(state.resourceConfig, refResourceConfig),
      envVars: isModified(state.envVars, refEnvVars),
      credentials: isModified(state.selectedCredentials, refCredentials),
      systemPrompt: isModified(state.systemPrompt, refSystemPrompt),
      setupScripts: isModified(state.setupScripts, template.setupScripts),
      terminalSidecar: isModified(state.template.terminalSidecar, refTerminalSidecar),
    };
  }, [state, template, preset]);

  return (
    <div className={styles.container}>
      {/* Session */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <Terminal className={styles.sectionIcon} />
            Session
          </span>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Name</span>
            <span className={styles.summaryValueMono}>{state.name}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>CLI Tool</span>
            <span className={styles.summaryValue}>
              {CLI_TOOL_LABELS[state.template.cliTool] ?? state.template.cliTool}
            </span>
          </div>
          {state.trackerIssue && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Issue</span>
              <TrackerIssueBadge issue={state.trackerIssue} />
            </div>
          )}
          {template.name && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Template</span>
              <span className={styles.summaryValue}>{template.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <FolderGit2 className={styles.sectionIcon} />
            Workspace
          </span>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Source Type</span>
            <span className={styles.summaryValue}>
              {isLocalMount ? 'Local Mount' : 'Git Repository'}
            </span>
          </div>
          {!isLocalMount && (
            <>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Repository</span>
                <span className={styles.summaryValueMono}>
                  {currentRepo ? `${currentRepo.org}/${currentRepo.name}` : state.repo}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Branch</span>
                <span className={styles.summaryValueMono}>{state.branch}</span>
              </div>
            </>
          )}
          {isLocalMount &&
            state.mountPaths
              .filter(p => p.host_path && p.mount_path)
              .map((p, i) => (
                <div key={i} className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Mount {i + 1}</span>
                  <span className={styles.summaryValueMono}>
                    {p.host_path} → {p.mount_path}
                    {p.read_only ? ' (ro)' : ' (rw)'}
                  </span>
                </div>
              ))}
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Setup Scripts</span>
            <span className={styles.summaryValue}>
              {state.setupScripts.filter(s => s.trim()).length || 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <HardDrive className={styles.sectionIcon} />
            Storage
          </span>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Workspace</span>
            <span className={styles.summaryValue}>
              {state.workspaceId ? `Reuse archived (${state.workspaceId})` : 'New workspace'}
            </span>
          </div>
        </div>
      </div>

      {/* Runtime */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <Cpu className={styles.sectionIcon} />
            Runtime
          </span>
          {modifications.model && <span className={styles.modifiedBadge}>Modified</span>}
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Model</span>
            <span className={styles.summaryValue}>{modelInfo ? modelInfo.name : state.model}</span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Resources</span>
            <span className={styles.summaryValue}>
              {state.resourceConfig.cpu || state.resourceConfig.memory || state.resourceConfig.gpu
                ? [
                    state.resourceConfig.cpu && `CPU: ${state.resourceConfig.cpu}`,
                    state.resourceConfig.memory && `Mem: ${state.resourceConfig.memory}`,
                    state.resourceConfig.gpu && `GPU: ${state.resourceConfig.gpu}`,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : 'Default'}
            </span>
          </div>
        </div>
      </div>

      {/* MCP Servers */}
      {state.mcpServers.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <Server className={styles.sectionIcon} />
              MCP Servers ({state.mcpServers.length})
            </span>
            {modifications.mcpServers && <span className={styles.modifiedBadge}>Modified</span>}
          </div>
          <div className={styles.tagList}>
            {state.mcpServers.map(server => (
              <span key={server.name} className={styles.tag}>
                <Server className={styles.tagIcon} />
                {server.name}
                <span className={styles.tagMeta}>({server.type})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Terminal */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <Shield className={styles.sectionIcon} />
            Terminal
          </span>
          {modifications.terminalSidecar && <span className={styles.modifiedBadge}>Modified</span>}
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Restricted</span>
            <span
              className={state.terminalRestricted ? styles.statusEnabled : styles.statusDisabled}
            >
              {state.terminalRestricted ? 'Yes' : 'No'}
            </span>
          </div>
          {state.terminalRestricted && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Allowed Commands</span>
              <span className={styles.summaryValue}>
                {state.template.terminalSidecar.allowedCommands.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Environment */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <Key className={styles.sectionIcon} />
            Environment
          </span>
          {modifications.envVars && <span className={styles.modifiedBadge}>Modified</span>}
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Variables</span>
            <span className={styles.summaryValue}>
              {Object.keys(state.envVars).length || 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Credentials */}
      {state.selectedCredentials.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <KeyRound className={styles.sectionIcon} />
              Credentials ({state.selectedCredentials.length})
            </span>
            {modifications.credentials && <span className={styles.modifiedBadge}>Modified</span>}
          </div>
          <div className={styles.tagList}>
            {state.selectedCredentials.map(name => (
              <span key={name} className={styles.tag}>
                <KeyRound className={styles.tagIcon} />
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Integrations */}
      {state.selectedIntegrations.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <Plug className={styles.sectionIcon} />
              Integrations ({state.selectedIntegrations.length})
            </span>
          </div>
          <div className={styles.tagList}>
            {state.selectedIntegrations.map(id => (
              <span key={id} className={styles.tag}>
                <Plug className={styles.tagIcon} />
                {id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Skills & Rules */}
      {(template.skills.length > 0 || template.rules.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <BookOpen className={styles.sectionIcon} />
              Skills & Rules
            </span>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Skills</span>
              <span className={styles.summaryValue}>{template.skills.length}</span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Rules</span>
              <span className={styles.summaryValue}>{template.rules.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* System Prompt */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            <FileText className={styles.sectionIcon} />
            System Prompt
          </span>
          {modifications.systemPrompt && <span className={styles.modifiedBadge}>Modified</span>}
        </div>
        {state.systemPrompt ? (
          <div className={styles.promptPreview}>{truncatePrompt(state.systemPrompt)}</div>
        ) : (
          <span className={styles.summaryValueMuted}>None</span>
        )}
      </div>

      {/* Setup Scripts */}
      {state.setupScripts.filter(s => s.trim()).length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <ScrollText className={styles.sectionIcon} />
              Setup Scripts ({state.setupScripts.filter(s => s.trim()).length})
            </span>
            {modifications.setupScripts && <span className={styles.modifiedBadge}>Modified</span>}
          </div>
          <div className={styles.tagList}>
            {state.setupScripts
              .filter(s => s.trim())
              .map((script, idx) => (
                <span key={idx} className={styles.tag}>
                  {script}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Preset info */}
      {state.preset && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>
              <Layers className={styles.sectionIcon} />
              Preset
            </span>
          </div>
          <span className={styles.summaryValue}>{state.preset.name}</span>
        </div>
      )}
    </div>
  );
}
