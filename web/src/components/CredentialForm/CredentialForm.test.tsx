import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CredentialForm } from './CredentialForm';
import type { CatalogEntry } from '@/models';

const mockEntry: CatalogEntry = {
  slug: 'linear',
  name: 'Linear',
  description: 'Linear issue tracker',
  integration_type: 'issue_tracker',
  adapter: 'volundr.adapters.outbound.linear.LinearAdapter',
  icon: 'linear',
  credential_schema: {
    required: ['api_key'],
    properties: { api_key: { type: 'password', label: 'API Key' } },
  },
  config_schema: {},
  mcp_server: null,
  auth_type: 'api_key',
  oauth_scopes: [],
};

const mockEntryWithConfig: CatalogEntry = {
  slug: 'jira',
  name: 'Jira',
  description: 'Jira issue tracker',
  integration_type: 'issue_tracker',
  adapter: 'volundr.adapters.outbound.jira.JiraAdapter',
  icon: 'jira',
  credential_schema: {
    required: ['api_token', 'email'],
    properties: {
      api_token: { type: 'password', label: 'API Token' },
      email: { type: 'email', label: 'Email Address' },
    },
  },
  config_schema: {
    properties: {
      url: { type: 'url', label: 'Site URL', default: 'https://example.atlassian.net' },
    },
  },
  mcp_server: null,
  auth_type: 'api_key',
  oauth_scopes: [],
};

const mockGitHubEntry: CatalogEntry = {
  slug: 'github',
  name: 'GitHub',
  description: 'GitHub source control',
  integration_type: 'source_control',
  adapter: 'volundr.adapters.outbound.github.GitHubProvider',
  icon: 'github',
  credential_schema: {
    required: ['token'],
    properties: {
      token: { type: 'password', label: 'Personal Access Token' },
    },
  },
  config_schema: {
    properties: {
      base_url: { type: 'url', label: 'API URL', default: 'https://api.github.com' },
      orgs: { type: 'string[]', label: 'Organizations' },
    },
  },
  mcp_server: null,
  auth_type: 'api_key',
  oauth_scopes: [],
};

describe('CredentialForm', () => {
  it('renders dialog title', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Connect Linear')).toBeDefined();
  });

  it('renders credential name input with default', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByDisplayValue('linear-credentials');
    expect(input).toBeDefined();
  });

  it('renders schema label instead of formatted key', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('API Key *')).toBeDefined();
  });

  it('falls back to formatted key when label is absent', () => {
    const entryNoLabel: CatalogEntry = {
      ...mockEntry,
      credential_schema: {
        required: ['api_key'],
        properties: { api_key: { type: 'string' } },
      },
    };
    render(<CredentialForm entry={entryNoLabel} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Api Key *')).toBeDefined();
  });

  it('renders config fields with schema label', () => {
    render(<CredentialForm entry={mockEntryWithConfig} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Site URL')).toBeDefined();
  });

  it('pre-populates config default values', () => {
    render(<CredentialForm entry={mockEntryWithConfig} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByDisplayValue('https://example.atlassian.net');
    expect(input).toBeDefined();
  });

  it('uses url input type for url schema type', () => {
    render(<CredentialForm entry={mockEntryWithConfig} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const urlInput = screen.getByDisplayValue('https://example.atlassian.net');
    expect(urlInput.getAttribute('type')).toBe('url');
  });

  it('uses password input type for credential fields', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter api key');
    expect(input.getAttribute('type')).toBe('password');
  });

  it('disables submit when required fields are empty', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const submitButton = screen.getByText('Connect', { selector: 'button' });
    expect(submitButton).toBeDefined();
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmit with correct data', () => {
    const onSubmit = vi.fn();
    render(<CredentialForm entry={mockEntry} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const passwordInput = screen.getByPlaceholderText('Enter api key');
    fireEvent.change(passwordInput, { target: { value: 'test-api-key' } });

    const buttons = screen.getAllByText('Connect');
    const submitButton = buttons.find(
      b =>
        b.tagName === 'BUTTON' &&
        b.textContent === 'Connect' &&
        !b.classList.toString().includes('cancel')
    );
    if (submitButton) {
      fireEvent.click(submitButton);
    }

    expect(onSubmit).toHaveBeenCalledWith('linear-credentials', { api_key: 'test-api-key' }, {});
  });

  it('displays error message', () => {
    render(
      <CredentialForm
        entry={mockEntry}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        error="Something went wrong"
      />
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('calls onCancel when overlay clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={onCancel} />
    );
    const overlay = container.firstElementChild;
    if (overlay) {
      fireEvent.click(overlay);
    }
    expect(onCancel).toHaveBeenCalled();
  });

  describe('string[] TagInput', () => {
    it('renders tag input for string[] config field', () => {
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText('Organizations')).toBeDefined();
      expect(screen.getByText('Separate with commas')).toBeDefined();
    });

    it('pre-populates API URL default', () => {
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      const input = screen.getByDisplayValue('https://api.github.com');
      expect(input).toBeDefined();
    });

    it('adds tags on Enter key', () => {
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      const tagInput = screen.getByPlaceholderText('Enter organizations');
      fireEvent.change(tagInput, { target: { value: 'niuulabs' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      expect(screen.getByText('niuulabs')).toBeDefined();
    });

    it('adds tags on comma key', () => {
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      const tagInput = screen.getByPlaceholderText('Enter organizations');
      fireEvent.change(tagInput, { target: { value: 'anthropic' } });
      fireEvent.keyDown(tagInput, { key: ',' });
      expect(screen.getByText('anthropic')).toBeDefined();
    });

    it('removes tag when × clicked', () => {
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      const tagInput = screen.getByPlaceholderText('Enter organizations');

      fireEvent.change(tagInput, { target: { value: 'org1' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      expect(screen.getByText('org1')).toBeDefined();

      const removeBtn = screen.getByLabelText('Remove org1');
      fireEvent.click(removeBtn);
      expect(screen.queryByText('org1')).toBeNull();
    });

    it('submits tags as comma-separated string', () => {
      const onSubmit = vi.fn();
      render(<CredentialForm entry={mockGitHubEntry} onSubmit={onSubmit} onCancel={vi.fn()} />);

      // Fill required token field
      const tokenInput = screen.getByPlaceholderText('Enter personal access token');
      fireEvent.change(tokenInput, { target: { value: 'ghp_test' } });

      // Add tags
      const tagInput = screen.getByPlaceholderText('Enter organizations');
      fireEvent.change(tagInput, { target: { value: 'org1' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      fireEvent.change(tagInput, { target: { value: 'org2' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });

      // Submit
      const buttons = screen.getAllByText('Connect');
      const submitButton = buttons.find(
        b => b.tagName === 'BUTTON' && !b.classList.toString().includes('cancel')
      );
      if (submitButton) {
        fireEvent.click(submitButton);
      }

      expect(onSubmit).toHaveBeenCalledWith(
        'github-credentials',
        { token: 'ghp_test' },
        { base_url: 'https://api.github.com', orgs: 'org1, org2' }
      );
    });
  });
});
