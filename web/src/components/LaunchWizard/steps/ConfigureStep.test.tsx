import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ConfigureStep } from './ConfigureStep';
import type { ConfigureStepProps } from './ConfigureStep';
import type { VolundrTemplate, VolundrRepo, VolundrModel, McpServerConfig } from '@/models';
import type { WizardState } from '../LaunchWizard';

const baseTemplate: VolundrTemplate = {
  name: '',
  description: '',
  isDefault: false,
  repos: [],
  setupScripts: [],
  workspaceLayout: {},
  cliTool: 'claude',
  workloadType: 'coding',
  model: null,
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

const mockRepos: VolundrRepo[] = [
  {
    provider: 'github',
    org: 'org',
    name: 'repo-one',
    cloneUrl: 'https://github.com/org/repo-one.git',
    url: 'https://github.com/org/repo-one',
    defaultBranch: 'main',
    branches: ['main', 'develop'],
  },
  {
    provider: 'gitlab',
    org: 'team',
    name: 'repo-two',
    cloneUrl: 'https://gitlab.com/team/repo-two.git',
    url: 'https://gitlab.com/team/repo-two',
    defaultBranch: 'master',
    branches: ['master', 'staging'],
  },
];

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

const mockMcpServers: McpServerConfig[] = [
  { name: 'filesystem', type: 'stdio', command: 'mcp-fs' },
  { name: 'git', type: 'stdio', command: 'mcp-git' },
];

function buildState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    template: baseTemplate,
    name: '',
    repo: '',
    branch: '',
    model: '',
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

let onChange: ReturnType<typeof vi.fn>;

const mockService = {
  listWorkspaces: vi.fn().mockResolvedValue([]),
  getCredentials: vi.fn().mockResolvedValue([]),
  getIntegrations: vi.fn().mockResolvedValue([]),
} as unknown as import('@/ports').IVolundrService;

function renderStep(overrides: Partial<ConfigureStepProps> = {}) {
  const props: ConfigureStepProps = {
    state: buildState(),
    presets: [],
    repos: mockRepos,
    models: mockModels,
    availableMcpServers: mockMcpServers,
    availableSecrets: ['GITHUB_TOKEN', 'NPM_TOKEN'],
    service: mockService,
    onChange,
    onSavePreset: vi.fn().mockResolvedValue({ id: 'p1', name: 'test' }),
    ...overrides,
  };
  return render(<ConfigureStep {...props} />);
}

describe('ConfigureStep', () => {
  beforeEach(() => {
    onChange = vi.fn();
  });

  describe('CLI Tool selector', () => {
    it('renders CLI tool options', () => {
      renderStep();

      expect(screen.getByText('Claude Code')).toBeInTheDocument();
      expect(screen.getByText('Codex')).toBeInTheDocument();
    });

    it('calls onChange when selecting a CLI tool', () => {
      renderStep();

      fireEvent.click(screen.getByText('Codex'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({ cliTool: 'codex' }),
        })
      );
    });
  });

  describe('basic fields', () => {
    it('renders session name input', () => {
      renderStep();

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      expect(input).toBeInTheDocument();
    });

    it('calls onChange when typing session name', () => {
      renderStep();

      fireEvent.change(screen.getByPlaceholderText('e.g. feature-auth-refactor'), {
        target: { value: 'my-session' },
      });

      expect(onChange).toHaveBeenCalledWith({ name: 'my-session' });
    });

    it('renders repository select with grouped options', () => {
      renderStep();

      expect(screen.getByText('Select repository...')).toBeInTheDocument();
      expect(screen.getByText('org/repo-one')).toBeInTheDocument();
      expect(screen.getByText('team/repo-two')).toBeInTheDocument();
    });

    it('updates repo and branch when selecting a repository', () => {
      renderStep();

      fireEvent.change(screen.getByDisplayValue('Select repository...'), {
        target: { value: 'https://github.com/org/repo-one.git' },
      });

      expect(onChange).toHaveBeenCalledWith({
        repo: 'https://github.com/org/repo-one.git',
        branch: 'main',
      });
    });

    it('renders branch select disabled when no repo selected', () => {
      renderStep();

      const branchSelect = screen.getByDisplayValue('Select branch...');
      expect(branchSelect).toBeDisabled();
    });

    it('renders branch options when repo is selected', () => {
      renderStep({
        state: buildState({ repo: 'https://github.com/org/repo-one.git', branch: 'main' }),
      });

      expect(screen.getByText('develop')).toBeInTheDocument();
    });

    it('renders model select with all models', () => {
      renderStep();

      expect(screen.getByText('Select model...')).toBeInTheDocument();
    });

    it('calls onChange when selecting model', () => {
      renderStep();

      fireEvent.change(screen.getByDisplayValue('Select model...'), {
        target: { value: 'claude-sonnet' },
      });

      expect(onChange).toHaveBeenCalledWith({ model: 'claude-sonnet' });
    });
  });

  describe('Linear issue search', () => {
    it('does not render Linear search when searchLinearIssues is not provided', () => {
      renderStep();

      expect(screen.queryByText('Linear Issue')).not.toBeInTheDocument();
    });

    it('renders Linear search when searchLinearIssues is provided', () => {
      renderStep({ searchLinearIssues: vi.fn().mockResolvedValue([]) });

      expect(screen.getByText('Linear Issue')).toBeInTheDocument();
    });
  });

  describe('advanced section', () => {
    it('is collapsed by default', () => {
      renderStep();

      expect(screen.getByText('Advanced Configuration')).toBeInTheDocument();
      expect(screen.queryByText('System Prompt')).not.toBeInTheDocument();
    });

    it('expands when toggle is clicked', () => {
      renderStep();

      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('System Prompt')).toBeInTheDocument();
      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
      expect(screen.getByText('Restrict terminal shell')).toBeInTheDocument();
      expect(screen.getByText('Resources')).toBeInTheDocument();
      expect(screen.getByText('Environment Variables')).toBeInTheDocument();
      expect(screen.getByText('Credentials')).toBeInTheDocument();
      expect(screen.getByText('Setup Scripts')).toBeInTheDocument();
    });

    it('sets aria-expanded on the toggle', () => {
      renderStep();

      const toggle = screen.getByText('Advanced Configuration').closest('button')!;
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('system prompt', () => {
    it('renders system prompt textarea in advanced section', () => {
      renderStep({ state: buildState({ systemPrompt: 'Be helpful.' }) });

      fireEvent.click(screen.getByText('Advanced Configuration'));

      const textarea = screen.getByPlaceholderText('Optional system prompt...');
      expect(textarea).toHaveValue('Be helpful.');
    });

    it('calls onChange when editing system prompt', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('Optional system prompt...'), {
        target: { value: 'New prompt' },
      });

      expect(onChange).toHaveBeenCalledWith({ systemPrompt: 'New prompt' });
    });
  });

  describe('MCP servers', () => {
    it('shows existing MCP servers', () => {
      renderStep({
        state: buildState({
          mcpServers: [{ name: 'filesystem', type: 'stdio', command: 'mcp-fs' }],
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('filesystem')).toBeInTheDocument();
    });

    it('shows add MCP server button', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('Add MCP Server')).toBeInTheDocument();
    });

    it('opens MCP picker when add is clicked', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));

      expect(screen.getByText('filesystem')).toBeInTheDocument();
      expect(screen.getByText('git')).toBeInTheDocument();
      expect(screen.getByText('Add Custom')).toBeInTheDocument();
    });

    it('adds an available MCP server when clicked in picker', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('filesystem'));

      expect(onChange).toHaveBeenCalledWith({
        mcpServers: [{ name: 'filesystem', type: 'stdio', command: 'mcp-fs' }],
      });
    });

    it('removes an MCP server', () => {
      renderStep({
        state: buildState({
          mcpServers: [{ name: 'filesystem', type: 'stdio', command: 'mcp-fs' }],
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByLabelText('Remove filesystem'));

      expect(onChange).toHaveBeenCalledWith({ mcpServers: [] });
    });
  });

  describe('restrict terminal shell toggle', () => {
    it('renders the restrict terminal toggle', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('Restrict terminal shell')).toBeInTheDocument();
    });

    it('calls onChange with terminalRestricted and sidecar enabled when toggling on', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      const switches = screen.getAllByRole('switch');
      const restrictedSwitch = switches[0];
      fireEvent.click(restrictedSwitch);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalRestricted: true,
          template: expect.objectContaining({
            terminalSidecar: expect.objectContaining({ enabled: true }),
          }),
        })
      );
    });

    it('calls onChange with terminalRestricted off and sidecar disabled when toggling off', () => {
      renderStep({
        state: buildState({
          terminalRestricted: true,
          template: {
            ...baseTemplate,
            terminalSidecar: { enabled: true, allowedCommands: ['npm test'] },
          },
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      const switches = screen.getAllByRole('switch');
      const restrictedSwitch = switches[0];
      fireEvent.click(restrictedSwitch);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalRestricted: false,
          template: expect.objectContaining({
            terminalSidecar: expect.objectContaining({ enabled: false }),
          }),
        })
      );
    });

    it('shows allowed commands when restricted is enabled', () => {
      renderStep({
        state: buildState({
          terminalRestricted: true,
          template: {
            ...baseTemplate,
            terminalSidecar: { enabled: true, allowedCommands: ['npm test'] },
          },
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByDisplayValue('npm test')).toBeInTheDocument();
      expect(screen.getByText('Add Command')).toBeInTheDocument();
    });

    it('does not show allowed commands when restricted is disabled', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.queryByText('Allowed Commands')).not.toBeInTheDocument();
      expect(screen.queryByText('Add Command')).not.toBeInTheDocument();
    });

    it('shows hint text below the toggle', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(
        screen.getByText(
          'When enabled, the session terminal is restricted to allowed commands only'
        )
      ).toBeInTheDocument();
    });
  });

  describe('resource config', () => {
    it('renders CPU, Memory, GPU inputs', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByPlaceholderText('e.g. 4')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. 8Gi')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. 1')).toBeInTheDocument();
    });

    it('calls onChange when setting CPU', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('e.g. 4'), {
        target: { value: '2' },
      });

      expect(onChange).toHaveBeenCalledWith({ resourceConfig: { cpu: '2' } });
    });
  });

  describe('environment variables', () => {
    it('shows existing env vars', () => {
      renderStep({
        state: buildState({ envVars: { NODE_ENV: 'production' } }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('NODE_ENV')).toBeInTheDocument();
      expect(screen.getByText('production')).toBeInTheDocument();
    });

    it('adds a new env var', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('Key'), {
        target: { value: 'MY_VAR' },
      });
      fireEvent.change(screen.getByPlaceholderText('Value'), {
        target: { value: 'hello' },
      });
      fireEvent.click(screen.getByText('Add'));

      expect(onChange).toHaveBeenCalledWith({ envVars: { MY_VAR: 'hello' } });
    });

    it('removes an env var', () => {
      renderStep({
        state: buildState({ envVars: { FOO: 'bar' } }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByLabelText('Remove FOO'));

      expect(onChange).toHaveBeenCalledWith({ envVars: {} });
    });
  });

  describe('unified credentials', () => {
    it('renders available secrets as checkboxes in credentials section', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
      expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument();
    });

    it('toggles an available secret as a credential', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.click(screen.getByText('GITHUB_TOKEN'));

      expect(onChange).toHaveBeenCalledWith({ selectedCredentials: ['GITHUB_TOKEN'] });
    });

    it('removes a credential when unchecked', () => {
      renderStep({
        state: buildState({ selectedCredentials: ['GITHUB_TOKEN'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.click(screen.getByText('GITHUB_TOKEN'));

      expect(onChange).toHaveBeenCalledWith({ selectedCredentials: [] });
    });

    it('shows empty state when no credentials are available', () => {
      renderStep({ availableSecrets: [] });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('No credentials available')).toBeInTheDocument();
    });
  });

  describe('preset dropdown', () => {
    const mockPreset = {
      id: 'p1',
      name: 'My Preset',
      description: 'A preset',
      isDefault: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      cliTool: 'claude' as const,
      workloadType: 'coding',
      model: 'claude-opus',
      systemPrompt: 'Be concise.',
      resourceConfig: { cpu: '4' },
      mcpServers: [{ name: 'git', type: 'stdio' as const, command: 'mcp-git' }],
      terminalSidecar: { enabled: true, allowedCommands: ['npm'] },
      skills: [],
      rules: [],
      envVars: { NODE_ENV: 'test' },
      envSecretRefs: ['GITHUB_TOKEN'],
      workloadConfig: {},
    };

    it('renders preset select when presets are provided', () => {
      renderStep({ presets: [mockPreset] });
      expect(screen.getByText('Load Preset')).toBeInTheDocument();
    });

    it('does not render preset select when no presets', () => {
      renderStep({ presets: [] });
      expect(screen.queryByText('Load Preset')).not.toBeInTheDocument();
    });

    it('populates fields when a preset is selected', () => {
      renderStep({ presets: [mockPreset] });

      const selects = document.querySelectorAll('select');
      const presetSelect = Array.from(selects).find(s => s.value === '')!;
      fireEvent.change(presetSelect, { target: { value: 'p1' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: mockPreset,
          model: 'claude-opus',
          systemPrompt: 'Be concise.',
          taskType: 'skuld-claude',
        })
      );
    });

    it('resets to template defaults when "none" is selected', () => {
      renderStep({
        presets: [mockPreset],
        state: buildState({ preset: mockPreset, model: 'claude-opus' }),
      });

      const selects = document.querySelectorAll('select');
      const presetSelect = Array.from(selects).find(s => s.value === 'p1')!;
      fireEvent.change(presetSelect, { target: { value: '' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: null,
        })
      );
    });
  });

  describe('YAML toggle', () => {
    it('shows Edit as YAML button in advanced section', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('Edit as YAML')).toBeInTheDocument();
    });

    it('calls onChange with yamlMode and serialized content when toggling to YAML', () => {
      renderStep({
        state: buildState({ model: 'claude-sonnet', systemPrompt: 'Be helpful.' }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Edit as YAML'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          yamlMode: true,
          yamlContent: expect.stringContaining('model: claude-sonnet'),
        })
      );
    });

    it('shows YAML textarea when yamlMode is true', () => {
      renderStep({
        state: buildState({ yamlMode: true, yamlContent: 'model: test' }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      const textareas = document.querySelectorAll('textarea');
      const yamlTextarea = Array.from(textareas).find(t => t.value === 'model: test');
      expect(yamlTextarea).toBeTruthy();
    });

    it('shows Form View button when in YAML mode', () => {
      renderStep({
        state: buildState({ yamlMode: true, yamlContent: 'model: test' }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('Form View')).toBeInTheDocument();
    });

    it('calls onChange with parsed fields when switching back to form', () => {
      renderStep({
        state: buildState({
          yamlMode: true,
          yamlContent: 'model: claude-opus\nsystem_prompt: Hello\n',
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Form View'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          yamlMode: false,
          model: 'claude-opus',
          systemPrompt: 'Hello',
        })
      );
    });
  });

  describe('custom MCP with empty name', () => {
    it('does not add custom MCP server when name is empty', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));

      // Leave the custom server name empty and try to add
      fireEvent.click(screen.getByText('Add Server'));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not add custom MCP server when name is only whitespace', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));

      fireEvent.change(screen.getByPlaceholderText('Server name (required)'), {
        target: { value: '   ' },
      });
      // The Add Server button should be disabled since customMcpName.trim() is empty
      expect(screen.getByText('Add Server')).toBeDisabled();
    });
  });

  describe('YAML toggle with invalid YAML', () => {
    it('sets yamlError when switching back to form with invalid YAML', () => {
      renderStep({
        state: buildState({
          yamlMode: true,
          yamlContent: 'invalid: yaml: [broken: {nope',
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Form View'));

      // The YAML error should be displayed in the DOM
      // parsePresetYaml uses js-yaml which throws on malformed YAML
      const errorElements = document.querySelectorAll('[class*="yamlError"]');
      expect(errorElements.length).toBeGreaterThan(0);

      // onChange should not have been called since parsing failed
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('resource config memory and GPU fields', () => {
    it('calls onChange when setting Memory', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('e.g. 8Gi'), {
        target: { value: '16Gi' },
      });

      expect(onChange).toHaveBeenCalledWith({
        resourceConfig: { memory: '16Gi' },
      });
    });

    it('calls onChange when setting GPU', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('e.g. 1'), {
        target: { value: '2' },
      });

      expect(onChange).toHaveBeenCalledWith({
        resourceConfig: { gpu: '2' },
      });
    });

    it('sets memory to undefined when cleared', () => {
      renderStep({
        state: buildState({ resourceConfig: { memory: '8Gi' } }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('e.g. 8Gi'), {
        target: { value: '' },
      });

      expect(onChange).toHaveBeenCalledWith({
        resourceConfig: { memory: undefined },
      });
    });

    it('sets gpu to undefined when cleared', () => {
      renderStep({
        state: buildState({ resourceConfig: { gpu: '1' } }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByPlaceholderText('e.g. 1'), {
        target: { value: '' },
      });

      expect(onChange).toHaveBeenCalledWith({
        resourceConfig: { gpu: undefined },
      });
    });
  });

  describe('allowed command editing and removal', () => {
    it('updates an allowed command', () => {
      renderStep({
        state: buildState({
          terminalRestricted: true,
          template: {
            ...baseTemplate,
            terminalSidecar: { enabled: true, allowedCommands: ['npm test'] },
          },
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByDisplayValue('npm test'), {
        target: { value: 'npm run build' },
      });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({
            terminalSidecar: expect.objectContaining({
              allowedCommands: ['npm run build'],
            }),
          }),
        })
      );
    });

    it('removes an allowed command', () => {
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
      fireEvent.click(screen.getByText('Advanced Configuration'));

      // Remove the first command
      const removeButtons = screen.getAllByLabelText('Remove command');
      fireEvent.click(removeButtons[0]);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({
            terminalSidecar: expect.objectContaining({
              allowedCommands: ['npm run lint'],
            }),
          }),
        })
      );
    });

    it('adds a new empty allowed command', () => {
      renderStep({
        state: buildState({
          terminalRestricted: true,
          template: {
            ...baseTemplate,
            terminalSidecar: { enabled: true, allowedCommands: ['npm test'] },
          },
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add Command'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({
            terminalSidecar: expect.objectContaining({
              allowedCommands: ['npm test', ''],
            }),
          }),
        })
      );
    });
  });

  describe('MCP server type selection', () => {
    it('opens the custom form via picker panel', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));

      expect(screen.getByPlaceholderText('Server name (required)')).toBeInTheDocument();
      expect(screen.getByText('stdio')).toBeInTheDocument();
      expect(screen.getByText('sse')).toBeInTheDocument();
      expect(screen.getByText('http')).toBeInTheDocument();
    });

    it('shows URL input for sse type', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));
      fireEvent.click(screen.getByText('sse'));

      expect(
        screen.getByPlaceholderText('URL (e.g. http://localhost:3000/sse)')
      ).toBeInTheDocument();
    });

    it('shows command and args inputs for stdio type', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));

      expect(screen.getByPlaceholderText('Command (e.g. mcp-server-github)')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Args (space-separated)')).toBeInTheDocument();
    });

    it('adds a custom sse server', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));
      fireEvent.click(screen.getByText('sse'));

      fireEvent.change(screen.getByPlaceholderText('Server name (required)'), {
        target: { value: 'my-sse-server' },
      });
      fireEvent.change(screen.getByPlaceholderText('URL (e.g. http://localhost:3000/sse)'), {
        target: { value: 'http://localhost:3000/sse' },
      });
      fireEvent.click(screen.getByText('Add Server'));

      expect(onChange).toHaveBeenCalledWith({
        mcpServers: [{ name: 'my-sse-server', type: 'sse', url: 'http://localhost:3000/sse' }],
      });
    });

    it('shows URL input for http type', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));
      fireEvent.click(screen.getByText('http'));

      expect(
        screen.getByPlaceholderText('URL (e.g. http://localhost:3000/sse)')
      ).toBeInTheDocument();
    });

    it('adds a custom stdio server with command and args', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));
      fireEvent.click(screen.getByText('Add MCP Server'));
      fireEvent.click(screen.getByText('Add Custom'));

      fireEvent.change(screen.getByPlaceholderText('Server name (required)'), {
        target: { value: 'my-stdio-server' },
      });
      fireEvent.change(screen.getByPlaceholderText('Command (e.g. mcp-server-github)'), {
        target: { value: 'my-cmd' },
      });
      fireEvent.change(screen.getByPlaceholderText('Args (space-separated)'), {
        target: { value: '--verbose --port 8080' },
      });
      fireEvent.click(screen.getByText('Add Server'));

      expect(onChange).toHaveBeenCalledWith({
        mcpServers: [
          {
            name: 'my-stdio-server',
            type: 'stdio',
            command: 'my-cmd',
            args: ['--verbose', '--port', '8080'],
          },
        ],
      });
    });

    it('shows type badge on existing MCP servers', () => {
      renderStep({
        state: buildState({
          mcpServers: [{ name: 'test-server', type: 'stdio', command: 'test-cmd' }],
        }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('test-server')).toBeInTheDocument();
      // Type badge should show
      const badges = screen.getAllByText('stdio');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  describe('save as preset', () => {
    it('shows save as preset button', () => {
      renderStep();

      expect(screen.getByText('Save as Preset')).toBeInTheDocument();
    });

    it('opens save form when clicked', () => {
      renderStep();
      fireEvent.click(screen.getByText('Save as Preset'));

      expect(screen.getByPlaceholderText('Preset name')).toBeInTheDocument();
    });

    it('calls onSavePreset when saving', async () => {
      const onSavePreset = vi.fn().mockResolvedValue({ id: 'new-p1', name: 'My Preset' });
      renderStep({ onSavePreset });
      fireEvent.click(screen.getByText('Save as Preset'));
      fireEvent.change(screen.getByPlaceholderText('Preset name'), {
        target: { value: 'My Preset' },
      });
      fireEvent.click(screen.getByText('Save'));

      expect(onSavePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Preset' }));
    });

    it('hides form when cancel is clicked', () => {
      renderStep();
      fireEvent.click(screen.getByText('Save as Preset'));
      expect(screen.getByPlaceholderText('Preset name')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByPlaceholderText('Preset name')).not.toBeInTheDocument();
    });
  });

  describe('credentials selection', () => {
    it('shows credentials when service returns them', async () => {
      const service = {
        ...mockService,
        getCredentials: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'anthropic-key', secretType: 'api_key', keys: ['key'], metadata: {} },
          { id: 'c2', name: 'gh-token', secretType: 'api_key', keys: ['token'], metadata: {} },
        ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({ service });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      // Wait for credentials to load
      expect(await screen.findByText('anthropic-key')).toBeInTheDocument();
      expect(screen.getByText('gh-token')).toBeInTheDocument();
    });

    it('toggles a credential on', async () => {
      const service = {
        ...mockService,
        getCredentials: vi
          .fn()
          .mockResolvedValue([
            { id: 'c1', name: 'anthropic-key', secretType: 'api_key', keys: ['key'], metadata: {} },
          ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({ service });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      const label = await screen.findByText('anthropic-key');
      fireEvent.click(label);

      expect(onChange).toHaveBeenCalledWith({
        selectedCredentials: ['anthropic-key'],
      });
    });

    it('toggles a credential off', async () => {
      const service = {
        ...mockService,
        getCredentials: vi
          .fn()
          .mockResolvedValue([
            { id: 'c1', name: 'anthropic-key', secretType: 'api_key', keys: ['key'], metadata: {} },
          ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({
        service,
        state: buildState({ selectedCredentials: ['anthropic-key'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      const label = await screen.findByText('anthropic-key');
      fireEvent.click(label);

      expect(onChange).toHaveBeenCalledWith({ selectedCredentials: [] });
    });
  });

  describe('integrations selection', () => {
    it('shows enabled integrations when service returns them', async () => {
      const service = {
        ...mockService,
        getIntegrations: vi.fn().mockResolvedValue([
          {
            id: 'int-1',
            integrationType: 'source_control',
            adapter: 'github',
            credentialName: 'gh-cred',
            config: {},
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            slug: 'github-main',
          },
          {
            id: 'int-2',
            integrationType: 'tracker',
            adapter: 'linear',
            credentialName: 'linear-cred',
            config: {},
            enabled: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            slug: 'linear-disabled',
          },
        ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({ service });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      // Only enabled integrations should appear
      expect(await screen.findByText('github-main')).toBeInTheDocument();
      expect(screen.queryByText('linear-disabled')).not.toBeInTheDocument();
    });

    it('toggles an integration on', async () => {
      const service = {
        ...mockService,
        getIntegrations: vi.fn().mockResolvedValue([
          {
            id: 'int-1',
            integrationType: 'source_control',
            adapter: 'github',
            credentialName: 'gh-cred',
            config: {},
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            slug: 'github-main',
          },
        ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({ service });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      const label = await screen.findByText('github-main');
      fireEvent.click(label);

      expect(onChange).toHaveBeenCalledWith({
        selectedIntegrations: ['int-1'],
      });
    });

    it('toggles an integration off', async () => {
      const service = {
        ...mockService,
        getIntegrations: vi.fn().mockResolvedValue([
          {
            id: 'int-1',
            integrationType: 'source_control',
            adapter: 'github',
            credentialName: 'gh-cred',
            config: {},
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            slug: 'github-main',
          },
        ]),
      } as unknown as import('@/ports').IVolundrService;

      renderStep({
        service,
        state: buildState({ selectedIntegrations: ['int-1'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));
      const label = await screen.findByText('github-main');
      fireEvent.click(label);

      expect(onChange).toHaveBeenCalledWith({ selectedIntegrations: [] });
    });

    it('shows empty state message when no integrations available', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByText('Select integrations')).toBeInTheDocument();
      expect(
        screen.getByText(
          'No integrations configured. Integrations are configured by your administrator.'
        )
      ).toBeInTheDocument();
    });
  });

  describe('setup scripts', () => {
    it('shows existing setup scripts', () => {
      renderStep({
        state: buildState({ setupScripts: ['npm install'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      expect(screen.getByDisplayValue('npm install')).toBeInTheDocument();
    });

    it('adds a new setup script', () => {
      renderStep();
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.click(screen.getByText('Add Script'));

      expect(onChange).toHaveBeenCalledWith({ setupScripts: [''] });
    });

    it('updates a setup script value', () => {
      renderStep({
        state: buildState({ setupScripts: ['npm install'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.change(screen.getByDisplayValue('npm install'), {
        target: { value: 'npm ci' },
      });

      expect(onChange).toHaveBeenCalledWith({ setupScripts: ['npm ci'] });
    });

    it('removes a setup script', () => {
      renderStep({
        state: buildState({ setupScripts: ['npm install'] }),
      });
      fireEvent.click(screen.getByText('Advanced Configuration'));

      fireEvent.click(screen.getByLabelText('Remove script'));

      expect(onChange).toHaveBeenCalledWith({ setupScripts: [] });
    });
  });
});
