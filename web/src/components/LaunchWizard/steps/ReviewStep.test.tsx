import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReviewStep } from './ReviewStep';
import type { ReviewStepProps } from './ReviewStep';
import type { VolundrTemplate, VolundrModel, VolundrRepo } from '@/models';
import type { WizardState } from '../LaunchWizard';

const baseTemplate: VolundrTemplate = {
  name: 'Standard',
  description: 'Standard template',
  isDefault: true,
  repos: [],
  setupScripts: [],
  workspaceLayout: {},
  cliTool: 'claude',
  workloadType: 'coding',
  model: 'claude-sonnet',
  systemPrompt: null,
  resourceConfig: {},
  mcpServers: [],
  envVars: {},
  envSecretRefs: [],
  workloadConfig: {},
  terminalSidecar: { enabled: false, allowedCommands: [] },
  skills: [],
  rules: [],
};

const mockModels: Record<string, VolundrModel> = {
  'claude-sonnet': {
    name: 'Claude Sonnet',
    provider: 'cloud',
    tier: 'balanced',
    color: '#f59e0b',
    cost: '$3/MTok',
  },
  'claude-opus': {
    name: 'Claude Opus',
    provider: 'cloud',
    tier: 'powerful',
    color: '#a855f7',
    cost: '$15/MTok',
  },
};

const mockRepos: VolundrRepo[] = [
  {
    provider: 'github',
    org: 'kanuckvalley',
    name: 'printer-firmware',
    cloneUrl: 'https://github.com/kanuckvalley/printer-firmware.git',
    url: 'https://github.com/kanuckvalley/printer-firmware',
    defaultBranch: 'main',
    branches: ['main', 'develop'],
  },
];

function buildState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    template: baseTemplate,
    name: 'my-session',
    sourceType: 'git',
    repo: 'https://github.com/kanuckvalley/printer-firmware.git',
    branch: 'main',
    mountPaths: [],
    model: 'claude-sonnet',
    taskType: '',
    mcpServers: [],
    resourceConfig: {},
    envVars: {},
    systemPrompt: '',
    setupScripts: [],
    preset: null,
    selectedCredentials: [],
    selectedIntegrations: [],
    terminalRestricted: false,
    yamlMode: false,
    yamlContent: '',
    ...overrides,
  };
}

function renderStep(overrides: Partial<ReviewStepProps> = {}) {
  const props: ReviewStepProps = {
    state: buildState(),
    repos: mockRepos,
    models: mockModels,
    ...overrides,
  };
  return render(<ReviewStep {...props} />);
}

describe('ReviewStep', () => {
  describe('session section', () => {
    it('shows session name', () => {
      renderStep();

      expect(screen.getByText('my-session')).toBeInTheDocument();
    });

    it('shows template name', () => {
      renderStep();

      expect(screen.getByText('Standard')).toBeInTheDocument();
    });

    it('shows CLI tool label and tool name', () => {
      renderStep({ state: buildState({ taskType: 'skuld-claude' }) });

      expect(screen.getByText('CLI Tool')).toBeInTheDocument();
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
    });

    it('shows CLI tool when task type is not set', () => {
      renderStep();

      expect(screen.getByText('CLI Tool')).toBeInTheDocument();
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
    });

    it('shows Codex for codex cli tool', () => {
      renderStep({
        state: buildState({
          template: { ...baseTemplate, cliTool: 'codex' },
        }),
      });

      expect(screen.getByText('CLI Tool')).toBeInTheDocument();
      expect(screen.getByText('Codex')).toBeInTheDocument();
    });

    it('shows tracker issue badge when set', () => {
      renderStep({
        state: buildState({
          trackerIssue: {
            id: '1',
            identifier: 'NIU-99',
            title: 'Test issue',
            status: 'in_progress',
            url: 'https://linear.app/niuu/issue/NIU-99',
          },
        }),
      });

      expect(screen.getByText('NIU-99')).toBeInTheDocument();
    });
  });

  describe('workspace section', () => {
    it('shows repository and branch', () => {
      renderStep();

      expect(screen.getByText('kanuckvalley/printer-firmware')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
    });

    it('shows setup script count', () => {
      renderStep({ state: buildState({ setupScripts: ['npm install', 'npm build'] }) });

      // Should show count of non-empty scripts
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('storage section', () => {
    it('shows New workspace when no workspaceId', () => {
      renderStep();

      expect(screen.getByText('New workspace')).toBeInTheDocument();
    });

    it('shows reuse archived when workspaceId is set', () => {
      renderStep({
        state: buildState({ workspaceId: 'ws-123' } as Partial<WizardState>),
      });

      expect(screen.getByText('Reuse archived (ws-123)')).toBeInTheDocument();
    });
  });

  describe('runtime section', () => {
    it('shows model name', () => {
      renderStep();

      expect(screen.getByText('Claude Sonnet')).toBeInTheDocument();
    });

    it('shows modified badge when model differs from template', () => {
      renderStep({ state: buildState({ model: 'claude-opus' }) });

      expect(screen.getByText('Claude Opus')).toBeInTheDocument();
      // Modified badge should appear on the runtime section
      expect(screen.getAllByText('Modified').length).toBeGreaterThanOrEqual(1);
    });

    it('shows resource config when set', () => {
      renderStep({
        state: buildState({ resourceConfig: { cpu: '4', memory: '8Gi' } }),
      });

      expect(screen.getByText('CPU: 4, Mem: 8Gi')).toBeInTheDocument();
    });

    it('shows Default when no resources configured', () => {
      renderStep();

      expect(screen.getByText('Default')).toBeInTheDocument();
    });
  });

  describe('MCP servers section', () => {
    it('does not show section when no MCP servers', () => {
      renderStep();

      expect(screen.queryByText(/MCP Servers/)).not.toBeInTheDocument();
    });

    it('shows MCP server tags', () => {
      renderStep({
        state: buildState({
          mcpServers: [
            { name: 'filesystem', type: 'stdio', command: 'mcp-fs' },
            { name: 'git', type: 'stdio', command: 'mcp-git' },
          ],
        }),
      });

      expect(screen.getByText(/MCP Servers \(2\)/)).toBeInTheDocument();
      expect(screen.getByText('filesystem')).toBeInTheDocument();
      expect(screen.getByText('git')).toBeInTheDocument();
    });
  });

  describe('terminal section', () => {
    it('shows restricted as No by default', () => {
      renderStep();

      expect(screen.getByText('Restricted')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('shows restricted as Yes when enabled', () => {
      renderStep({ state: buildState({ terminalRestricted: true }) });

      expect(screen.getByText('Yes')).toBeInTheDocument();
    });

    it('does not show allowed commands count when not restricted', () => {
      renderStep();

      expect(screen.queryByText('Allowed Commands')).not.toBeInTheDocument();
    });

    it('shows allowed commands count when restricted', () => {
      renderStep({
        state: buildState({
          terminalRestricted: true,
          template: {
            ...baseTemplate,
            terminalSidecar: {
              enabled: true,
              allowedCommands: ['npm test', 'npm run lint'],
            },
          },
        }),
      });

      expect(screen.getByText('Allowed Commands')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('environment section', () => {
    it('shows env var count and credentials separately', () => {
      renderStep({
        state: buildState({
          envVars: { NODE_ENV: 'production' },
          selectedCredentials: ['GITHUB_TOKEN'],
        }),
      });

      // Credentials section should show the selected credential
      expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
      expect(screen.getByText(/Credentials \(1\)/)).toBeInTheDocument();
    });

    it('shows None when no env vars', () => {
      renderStep();

      // Variables show "None"
      const noneElements = screen.getAllByText('None');
      expect(noneElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('skills & rules section', () => {
    it('does not show section when no skills or rules', () => {
      renderStep();

      expect(screen.queryByText('Skills & Rules')).not.toBeInTheDocument();
    });

    it('shows counts when skills and rules exist', () => {
      renderStep({
        state: buildState({
          template: {
            ...baseTemplate,
            skills: [{ name: 'test-skill', enabled: true }],
            rules: [{ name: 'test-rule', content: 'rule content' }],
          },
        }),
      });

      expect(screen.getByText('Skills & Rules')).toBeInTheDocument();
    });
  });

  describe('system prompt section', () => {
    it('shows None when no system prompt', () => {
      renderStep();

      // "None" text appears in the system prompt section
      const noneElements = screen.getAllByText('None');
      expect(noneElements.length).toBeGreaterThanOrEqual(1);
    });

    it('shows truncated prompt preview', () => {
      renderStep({
        state: buildState({
          systemPrompt: 'Line one\nLine two\nLine three\nLine four',
        }),
      });

      const preview = screen.getByText(/Line one/);
      expect(preview.textContent).toContain('Line one');
      expect(preview.textContent).toContain('Line two');
      expect(preview.textContent).toContain('...');
    });

    it('shows modified badge when prompt differs from template', () => {
      renderStep({
        state: buildState({ systemPrompt: 'Custom prompt' }),
      });

      expect(screen.getByText('Custom prompt')).toBeInTheDocument();
      expect(screen.getAllByText('Modified').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('credentials section', () => {
    it('does not show credentials section when none selected', () => {
      renderStep();

      expect(screen.queryByText(/Credentials/)).not.toBeInTheDocument();
    });

    it('shows credentials with count when selected', () => {
      renderStep({
        state: buildState({
          selectedCredentials: ['anthropic-key', 'gh-token'],
        }),
      });

      expect(screen.getByText(/Credentials \(2\)/)).toBeInTheDocument();
      expect(screen.getByText('anthropic-key')).toBeInTheDocument();
      expect(screen.getByText('gh-token')).toBeInTheDocument();
    });
  });

  describe('integrations section', () => {
    it('does not show integrations section when none selected', () => {
      renderStep();

      expect(screen.queryByText(/Integrations/)).not.toBeInTheDocument();
    });

    it('shows integrations with count when selected', () => {
      renderStep({
        state: buildState({
          selectedIntegrations: ['int-github', 'int-linear'],
        }),
      });

      expect(screen.getByText(/Integrations \(2\)/)).toBeInTheDocument();
      expect(screen.getByText('int-github')).toBeInTheDocument();
      expect(screen.getByText('int-linear')).toBeInTheDocument();
    });
  });

  describe('modified indicators', () => {
    it('shows no modified badges when nothing changed from template', () => {
      renderStep();

      expect(screen.queryByText('Modified')).not.toBeInTheDocument();
    });

    it('shows modified badge for env vars changes', () => {
      renderStep({
        state: buildState({ envVars: { NEW_VAR: 'value' } }),
      });

      expect(screen.getAllByText('Modified').length).toBeGreaterThanOrEqual(1);
    });

    it('shows modified badge for setup scripts changes', () => {
      renderStep({
        state: buildState({ setupScripts: ['npm install'] }),
      });

      expect(screen.getAllByText('Modified').length).toBeGreaterThanOrEqual(1);
    });
  });
});
