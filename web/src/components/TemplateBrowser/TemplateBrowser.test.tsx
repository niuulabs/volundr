import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TemplateBrowser } from './TemplateBrowser';
import type { VolundrTemplate, VolundrRepo, VolundrModel } from '@/models';

// ── Mock Data ──────────────────────────────────────────────────────

const mockModels: Record<string, VolundrModel> = {
  'llama-70b': {
    name: 'Llama 3.1 70B',
    provider: 'local',
    tier: 'balanced',
    color: '#10b981',
    vram: '40GB',
  },
  'claude-opus': {
    name: 'Claude Opus',
    provider: 'cloud',
    tier: 'frontier',
    color: '#a855f7',
    cost: '$15/MTok',
  },
  'mistral-7b': {
    name: 'Mistral 7B',
    provider: 'local',
    tier: 'execution',
    color: '#06b6d4',
    vram: '8GB',
  },
};

const mockRepos: VolundrRepo[] = [
  {
    provider: 'github',
    org: 'asgard',
    name: 'bifrost',
    cloneUrl: 'https://github.com/asgard/bifrost.git',
    url: 'https://github.com/asgard/bifrost',
    defaultBranch: 'main',
    branches: ['main', 'develop', 'feature/rainbow'],
  },
  {
    provider: 'github',
    org: 'asgard',
    name: 'mjolnir',
    cloneUrl: 'https://github.com/asgard/mjolnir.git',
    url: 'https://github.com/asgard/mjolnir',
    defaultBranch: 'main',
    branches: ['main', 'release/v2'],
  },
  {
    provider: 'gitlab',
    org: 'midgard',
    name: 'yggdrasil',
    cloneUrl: 'https://gitlab.com/midgard/yggdrasil.git',
    url: 'https://gitlab.com/midgard/yggdrasil',
    defaultBranch: 'trunk',
    branches: ['trunk', 'dev'],
  },
];

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

const mockTemplates: VolundrTemplate[] = [
  {
    ...baseTemplate,
    name: 'Full Stack',
    description:
      'A template for full-stack development with all the bells and whistles included for maximum productivity.',
    repos: [
      { repo: 'https://github.com/asgard/bifrost.git', branch: 'develop' },
      { repo: 'https://github.com/asgard/mjolnir.git' },
    ],
    setupScripts: ['npm install', 'npm run build'],
    workspaceLayout: { split: 'horizontal' },
    isDefault: true,
    model: 'llama-70b',
    resourceConfig: { cpu: '4', memory: '8Gi' },
    mcpServers: [{ name: 'filesystem', type: 'stdio', command: 'mcp-fs' }],
    envSecretRefs: ['GITHUB_TOKEN', 'NPM_TOKEN'],
  },
  {
    ...baseTemplate,
    name: 'Minimal',
    description: 'A minimal template for quick tasks.',
    repos: [{ repo: 'https://github.com/asgard/bifrost.git' }],
    workloadType: 'review',
  },
  {
    ...baseTemplate,
    name: 'No Config',
    description: 'Template without any extra configuration.',
  },
];

// ── Helpers ────────────────────────────────────────────────────────

const defaultProps = {
  templates: mockTemplates,
  repos: mockRepos,
  models: mockModels,
  onLaunch: vi.fn().mockResolvedValue(undefined),
  isLaunching: false,
};

function renderBrowser(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<TemplateBrowser {...props} />);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TemplateBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onLaunch = vi.fn().mockResolvedValue(undefined);
  });

  // ── Rendering Basics ────────────────────────────────────────────

  describe('rendering basics', () => {
    it('renders the grid container', () => {
      const { container } = renderBrowser();
      expect(container.firstChild).toBeInTheDocument();
    });

    it('renders all template cards', () => {
      renderBrowser();
      expect(screen.getByText('Full Stack')).toBeInTheDocument();
      expect(screen.getByText('Minimal')).toBeInTheDocument();
      expect(screen.getByText('No Config')).toBeInTheDocument();
    });

    it('renders template names', () => {
      renderBrowser();
      for (const template of mockTemplates) {
        expect(screen.getByText(template.name)).toBeInTheDocument();
      }
    });

    it('renders template descriptions', () => {
      renderBrowser();
      expect(screen.getByText(/A template for full-stack development/)).toBeInTheDocument();
      expect(screen.getByText('A minimal template for quick tasks.')).toBeInTheDocument();
    });

    it('renders empty when templates array is empty', () => {
      const { container } = renderBrowser({ templates: [] });
      // Grid exists but has no card children
      expect(container.firstChild).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  // ── Badges ──────────────────────────────────────────────────────

  describe('badges', () => {
    it('shows repo count badge with plural "repos"', () => {
      renderBrowser();
      expect(screen.getByText('2 repos')).toBeInTheDocument();
    });

    it('shows repo count badge with singular "repo"', () => {
      renderBrowser();
      expect(screen.getByText('1 repo')).toBeInTheDocument();
    });

    it('hides repo badge when template has no repos', () => {
      renderBrowser({ templates: [mockTemplates[2]] });
      expect(screen.queryByText(/\d+ repo/)).not.toBeInTheDocument();
    });

    it('shows model badge from template', () => {
      renderBrowser();
      // "Full Stack" template has model "llama-70b"
      expect(screen.getByText('llama-70b')).toBeInTheDocument();
    });

    it('hides model badge when template has no model', () => {
      // "Minimal" template has model: null
      renderBrowser({ templates: [mockTemplates[1]] });
      expect(screen.queryByText('llama-70b')).not.toBeInTheDocument();
      expect(screen.queryByText('claude-opus')).not.toBeInTheDocument();
    });
  });

  // ── Card Expansion ──────────────────────────────────────────────

  describe('card expansion', () => {
    it('expands a card when clicked', () => {
      renderBrowser();
      expect(screen.queryByPlaceholderText('e.g. feature-auth-refactor')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Full Stack'));
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();
    });

    it('collapses a card when clicking Cancel', () => {
      renderBrowser();

      // Expand
      fireEvent.click(screen.getByText('Full Stack'));
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();

      // The expanded card no longer has role="button", so we click Cancel to collapse
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByPlaceholderText('e.g. feature-auth-refactor')).not.toBeInTheDocument();
    });

    it('only expands one card at a time (accordion behavior)', () => {
      renderBrowser();

      // Expand first card
      fireEvent.click(screen.getByText('Full Stack'));
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();

      // Expand second card (first should collapse since "Minimal" is a different card)
      fireEvent.click(screen.getByText('Minimal'));
      // Should still have exactly one session name input
      const inputs = screen.getAllByPlaceholderText('e.g. feature-auth-refactor');
      expect(inputs).toHaveLength(1);
    });

    it('shows form fields when card is expanded', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      expect(screen.getByText('Session Name')).toBeInTheDocument();
      expect(screen.getByText('Repository')).toBeInTheDocument();
      expect(screen.getByText('Branch')).toBeInTheDocument();
      expect(screen.getByText('Model')).toBeInTheDocument();
    });
  });

  // ── Keyboard Navigation ─────────────────────────────────────────

  describe('keyboard navigation', () => {
    it('expands card on Enter key', () => {
      renderBrowser();
      const card = screen.getByText('Full Stack').closest('[role="button"]')!;

      fireEvent.keyDown(card, { key: 'Enter' });
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();
    });

    it('expands card on Space key', () => {
      renderBrowser();
      const card = screen.getByText('Minimal').closest('[role="button"]')!;

      fireEvent.keyDown(card, { key: ' ' });
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();
    });

    it('collapsed cards have tabIndex=0 for focusability', () => {
      renderBrowser();
      const card = screen.getByText('Full Stack').closest('[role="button"]')!;
      expect(card).toHaveAttribute('tabindex', '0');
    });
  });

  // ── Auto-fill on Expand ─────────────────────────────────────────

  describe('auto-fill on expand', () => {
    it('auto-fills model from template', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const modelSelect = screen.getByDisplayValue(/Llama 3\.1 70B/);
      expect(modelSelect).toBeInTheDocument();
    });

    it('auto-fills repo from template first repo', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      // The first repo is bifrost.git
      const repoSelect = screen.getAllByRole('combobox')[0];
      expect(repoSelect).toHaveValue('https://github.com/asgard/bifrost.git');
    });

    it('auto-fills branch from template repo branch', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      // Template's first repo specifies branch: 'develop'
      const branchSelect = screen.getAllByRole('combobox')[1];
      expect(branchSelect).toHaveValue('develop');
    });

    it('auto-fills branch from repo default when template repo has no branch', () => {
      renderBrowser();
      // "Minimal" template has repo without branch specified
      fireEvent.click(screen.getByText('Minimal'));

      const branchSelect = screen.getAllByRole('combobox')[1];
      // bifrost's defaultBranch is 'main'
      expect(branchSelect).toHaveValue('main');
    });

    it('clears model when template has no model', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Minimal'));

      // "Minimal" template has model: null
      const modelSelect = screen.getAllByRole('combobox')[2];
      expect(modelSelect).toHaveValue('');
    });

    it('clears form when no matching repo found', () => {
      const templateWithUnknownRepo: VolundrTemplate = {
        ...baseTemplate,
        name: 'Unknown Repo',
        description: 'Has a repo not in the repos list',
        repos: [{ repo: 'https://github.com/unknown/repo.git' }],
      };
      renderBrowser({ templates: [templateWithUnknownRepo] });
      fireEvent.click(screen.getByText('Unknown Repo'));

      const repoSelect = screen.getAllByRole('combobox')[0];
      expect(repoSelect).toHaveValue('');
    });

    it('handles template with no repos', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('No Config'));

      const repoSelect = screen.getAllByRole('combobox')[0];
      expect(repoSelect).toHaveValue('');

      const branchSelect = screen.getAllByRole('combobox')[1];
      expect(branchSelect).toHaveValue('');
    });
  });

  // ── Form Interaction ────────────────────────────────────────────

  describe('form interaction', () => {
    it('allows typing a session name', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'my-session' } });
      expect(input).toHaveValue('my-session');
    });

    it('changing repo updates the selected repo', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const repoSelect = screen.getAllByRole('combobox')[0];
      fireEvent.change(repoSelect, { target: { value: 'https://github.com/asgard/mjolnir.git' } });
      expect(repoSelect).toHaveValue('https://github.com/asgard/mjolnir.git');
    });

    it('changing repo resets branch to that repo default', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const repoSelect = screen.getAllByRole('combobox')[0];
      fireEvent.change(repoSelect, {
        target: { value: 'https://gitlab.com/midgard/yggdrasil.git' },
      });

      const branchSelect = screen.getAllByRole('combobox')[1];
      // yggdrasil defaultBranch is 'trunk'
      expect(branchSelect).toHaveValue('trunk');
    });

    it('changing model updates the model select', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const modelSelect = screen.getAllByRole('combobox')[2];
      fireEvent.change(modelSelect, { target: { value: 'claude-opus' } });
      expect(modelSelect).toHaveValue('claude-opus');
    });

    it('branch select is disabled when no repo is selected', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('No Config'));

      const branchSelect = screen.getAllByRole('combobox')[1];
      expect(branchSelect).toBeDisabled();
    });
  });

  // ── Create Session Button ───────────────────────────────────────

  describe('Create Session button', () => {
    it('is disabled when session name is empty', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      // Repo and model are auto-filled, but session name is empty
      const launchBtn = screen.getByText('Create Session');
      expect(launchBtn).toBeDisabled();
    });

    it('is disabled when no repo is selected', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('No Config'));

      // No repos, no model
      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'test-session' } });

      const launchBtn = screen.getByText('Create Session');
      expect(launchBtn).toBeDisabled();
    });

    it('is disabled when no model is selected', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Minimal'));

      // "Minimal" template has no model, but repo is auto-filled
      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'test-session' } });

      const launchBtn = screen.getByText('Create Session');
      expect(launchBtn).toBeDisabled();
    });

    it('is enabled when all fields are filled', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'my-session' } });

      const launchBtn = screen.getByText('Create Session');
      expect(launchBtn).not.toBeDisabled();
    });

    it('calls onLaunch with correct arguments', async () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'my-session' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(defaultProps.onLaunch).toHaveBeenCalledWith({
          name: 'my-session',
          repo: 'https://github.com/asgard/bifrost.git',
          branch: 'develop',
          model: 'llama-70b',
          templateName: 'Full Stack',
        });
      });
    });

    it('trims session name whitespace when launching', async () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: '  spaced-name  ' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(defaultProps.onLaunch).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'spaced-name' })
        );
      });
    });

    it('shows "Creating..." when isLaunching is true', () => {
      renderBrowser({ isLaunching: true });
      fireEvent.click(screen.getByText('Full Stack'));

      expect(screen.getByText('Creating...')).toBeInTheDocument();
      expect(screen.queryByText('Create Session')).not.toBeInTheDocument();
    });

    it('disables launch button when isLaunching is true', () => {
      renderBrowser({ isLaunching: true });
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'my-session' } });

      const launchBtn = screen.getByText('Creating...');
      expect(launchBtn).toBeDisabled();
    });

    it('resets form and collapses card after successful launch', async () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'my-session' } });

      fireEvent.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(defaultProps.onLaunch).toHaveBeenCalled();
      });

      // After launch resolves, form should be collapsed
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('e.g. feature-auth-refactor')).not.toBeInTheDocument();
      });
    });
  });

  // ── Cancel ──────────────────────────────────────────────────────

  describe('cancel', () => {
    it('collapses card and resets form when Cancel is clicked', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'typed-name' } });

      fireEvent.click(screen.getByText('Cancel'));

      // Card should collapse, form gone
      expect(screen.queryByPlaceholderText('e.g. feature-auth-refactor')).not.toBeInTheDocument();
    });

    it('form is reset when re-expanding after cancel', () => {
      renderBrowser();

      // Expand and type
      fireEvent.click(screen.getByText('Full Stack'));
      const input = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      fireEvent.change(input, { target: { value: 'old-name' } });

      // Cancel
      fireEvent.click(screen.getByText('Cancel'));

      // Re-expand
      fireEvent.click(screen.getByText('Full Stack'));
      const newInput = screen.getByPlaceholderText('e.g. feature-auth-refactor');
      expect(newInput).toHaveValue('');
    });
  });

  // ── Advanced Section ────────────────────────────────────────────

  describe('advanced section', () => {
    it('shows the Advanced toggle button when expanded', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('clicking Advanced toggles the section open', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      // Advanced content should not be visible initially
      expect(screen.queryByText('Setup Scripts')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Setup Scripts')).toBeInTheDocument();
    });

    it('clicking Advanced again closes the section', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Setup Scripts')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.queryByText('Setup Scripts')).not.toBeInTheDocument();
    });

    it('shows setup scripts in advanced section', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('npm install')).toBeInTheDocument();
      expect(screen.getByText('npm run build')).toBeInTheDocument();
    });

    it('shows MCP servers in advanced section', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
      expect(screen.getByText('filesystem')).toBeInTheDocument();
    });

    it('shows resource config in advanced section', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('Resources')).toBeInTheDocument();
      expect(screen.getByText('cpu')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('memory')).toBeInTheDocument();
      expect(screen.getByText('8Gi')).toBeInTheDocument();
    });

    it('shows environment secrets in advanced section', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('Environment Secrets')).toBeInTheDocument();
      expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
      expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument();
    });

    it('shows "No advanced configuration." when template has no advanced config', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Minimal'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('No advanced configuration.')).toBeInTheDocument();
    });

    it('shows "No advanced configuration." for template with no config', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('No Config'));
      fireEvent.click(screen.getByText('Advanced'));

      expect(screen.getByText('No advanced configuration.')).toBeInTheDocument();
    });

    it('resets advanced section state when switching templates', () => {
      renderBrowser();

      // Expand Full Stack and open Advanced
      fireEvent.click(screen.getByText('Full Stack'));
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByText('Setup Scripts')).toBeInTheDocument();

      // Switch to Minimal
      fireEvent.click(screen.getByText('Minimal'));

      // Advanced should be closed in the new card
      expect(screen.queryByText('No advanced configuration.')).not.toBeInTheDocument();
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles template with no config gracefully', () => {
      renderBrowser({ templates: [mockTemplates[2]] });
      fireEvent.click(screen.getByText('No Config'));

      // Should render form without crashing
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();
    });

    it('does not call onLaunch when form is incomplete', async () => {
      renderBrowser();
      fireEvent.click(screen.getByText('No Config'));

      // All fields are empty; button should be disabled, but let's also verify no call
      const launchBtn = screen.getByText('Create Session');
      fireEvent.click(launchBtn);

      // Give a tick for any async actions
      await waitFor(() => {
        expect(defaultProps.onLaunch).not.toHaveBeenCalled();
      });
    });

    it('renders repos grouped by provider in the select', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const repoSelect = screen.getAllByRole('combobox')[0];
      const optgroups = repoSelect.querySelectorAll('optgroup');
      const labels = Array.from(optgroups).map(g => g.getAttribute('label'));

      expect(labels).toContain('GitHub');
      expect(labels).toContain('GitLab');
    });

    it('renders model options with provider icons', () => {
      renderBrowser();
      fireEvent.click(screen.getByText('Full Stack'));

      const modelSelect = screen.getAllByRole('combobox')[2];
      const options = within(modelSelect).getAllByRole('option');

      // First option is placeholder
      expect(options[0]).toHaveTextContent('Select model...');

      // Local models get lightning bolt, cloud models get cloud
      const optionTexts = options.map(o => o.textContent);
      expect(optionTexts.some(t => t?.includes('Llama 3.1 70B'))).toBe(true);
      expect(optionTexts.some(t => t?.includes('Claude Opus'))).toBe(true);
    });

    it('handles multiple templates with the same config', () => {
      const duplicateTemplates: VolundrTemplate[] = [
        { ...mockTemplates[0], name: 'Template A' },
        { ...mockTemplates[0], name: 'Template B' },
      ];
      renderBrowser({ templates: duplicateTemplates });

      expect(screen.getByText('Template A')).toBeInTheDocument();
      expect(screen.getByText('Template B')).toBeInTheDocument();

      // Expand A then B - only B should be expanded
      fireEvent.click(screen.getByText('Template A'));
      expect(screen.getByPlaceholderText('e.g. feature-auth-refactor')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Template B'));
      const inputs = screen.getAllByPlaceholderText('e.g. feature-auth-refactor');
      expect(inputs).toHaveLength(1);
    });
  });
});
