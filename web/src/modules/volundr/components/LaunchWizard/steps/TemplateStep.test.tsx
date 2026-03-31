import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TemplateStep } from './TemplateStep';
import type { VolundrTemplate } from '@/modules/volundr/models';

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
    name: 'Full Stack Dev',
    description: 'Full-stack workspace with all tools',
    isDefault: true,
    model: 'claude-sonnet',
    workloadType: 'coding',
    repos: [{ repo: 'https://github.com/org/repo.git' }],
    resourceConfig: { cpu: '4', memory: '8Gi' },
  },
  {
    ...baseTemplate,
    name: 'Code Review',
    description: 'Lightweight review workspace',
    workloadType: 'review',
    model: 'llama-70b',
  },
  {
    ...baseTemplate,
    name: 'Infra Debug',
    description: 'Infrastructure debugging',
    workloadType: 'debugging',
  },
];

describe('TemplateStep', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders all template cards', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('Full Stack Dev')).toBeInTheDocument();
      expect(screen.getByText('Code Review')).toBeInTheDocument();
      expect(screen.getByText('Infra Debug')).toBeInTheDocument();
    });

    it('renders blank card', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('Blank')).toBeInTheDocument();
      expect(
        screen.getByText('Start from scratch with an empty configuration')
      ).toBeInTheDocument();
    });

    it('renders template descriptions', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('Full-stack workspace with all tools')).toBeInTheDocument();
      expect(screen.getByText('Lightweight review workspace')).toBeInTheDocument();
    });

    it('renders search input', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
    });

    it('shows default star on default templates', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByLabelText('Default template')).toBeInTheDocument();
    });
  });

  describe('badges', () => {
    it('shows model badge when template has a model', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
      expect(screen.getByText('llama-70b')).toBeInTheDocument();
    });

    it('shows repo count badge', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('1 repo')).toBeInTheDocument();
    });

    it('shows workload type badge', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('coding')).toBeInTheDocument();
      expect(screen.getByText('review')).toBeInTheDocument();
    });

    it('shows resource summary when present', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByText('cpu: 4')).toBeInTheDocument();
      expect(screen.getByText('memory: 8Gi')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('calls onSelect with template when card is clicked', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Full Stack Dev'));
      expect(onSelect).toHaveBeenCalledWith(mockTemplates[0]);
    });

    it('calls onSelect with null when blank card is clicked', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Blank'));
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('cards have accessible labels', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      expect(screen.getByLabelText('Select template Full Stack Dev')).toBeInTheDocument();
      expect(screen.getByLabelText('Start from scratch')).toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('filters templates by name', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'review' } });

      expect(screen.getByText('Code Review')).toBeInTheDocument();
      expect(screen.queryByText('Full Stack Dev')).not.toBeInTheDocument();
      expect(screen.queryByText('Infra Debug')).not.toBeInTheDocument();
    });

    it('filters templates by description', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'infrastructure' } });

      expect(screen.getByText('Infra Debug')).toBeInTheDocument();
      expect(screen.queryByText('Full Stack Dev')).not.toBeInTheDocument();
    });

    it('filters templates by workload type', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'debugging' } });

      expect(screen.getByText('Infra Debug')).toBeInTheDocument();
      expect(screen.queryByText('Full Stack Dev')).not.toBeInTheDocument();
    });

    it('shows empty message when no templates match', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      expect(screen.getByText(/No templates match/)).toBeInTheDocument();
    });

    it('is case-insensitive', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'FULL STACK' } });

      expect(screen.getByText('Full Stack Dev')).toBeInTheDocument();
    });

    it('blank card is always visible regardless of search', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'review' } });

      // Blank card should still be there
      expect(screen.getByText('Blank')).toBeInTheDocument();
    });

    it('shows all templates when search is cleared', () => {
      render(<TemplateStep templates={mockTemplates} onSelect={onSelect} />);

      const searchInput = screen.getByPlaceholderText('Search templates...');
      fireEvent.change(searchInput, { target: { value: 'review' } });
      fireEvent.change(searchInput, { target: { value: '' } });

      expect(screen.getByText('Full Stack Dev')).toBeInTheDocument();
      expect(screen.getByText('Code Review')).toBeInTheDocument();
      expect(screen.getByText('Infra Debug')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('renders with empty templates array', () => {
      render(<TemplateStep templates={[]} onSelect={onSelect} />);

      // Blank card should still be present
      expect(screen.getByText('Blank')).toBeInTheDocument();
    });
  });
});
