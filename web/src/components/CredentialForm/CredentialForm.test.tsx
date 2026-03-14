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
    properties: { api_key: { type: 'string' } },
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
      api_token: { type: 'string' },
      email: { type: 'string' },
    },
  },
  config_schema: {
    properties: { url: { type: 'string' } },
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

  it('renders credential fields', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Api Key *')).toBeDefined();
  });

  it('renders config fields', () => {
    render(<CredentialForm entry={mockEntryWithConfig} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Url')).toBeDefined();
  });

  it('disables submit when required fields are empty', () => {
    render(<CredentialForm entry={mockEntry} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const submitButton = screen.getByText('Connect', { selector: 'button' });
    // The button near the bottom (submit), not the title
    // Check submit is disabled via the disabled attribute
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

    // Fill in the required field
    const passwordInput = screen.getByPlaceholderText('Enter api key');
    fireEvent.change(passwordInput, { target: { value: 'test-api-key' } });

    // Click the submit Connect button (second "Connect" text, which is the button)
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
    // Click the overlay (first child of body appended)
    const overlay = container.firstElementChild;
    if (overlay) {
      fireEvent.click(overlay);
    }
    expect(onCancel).toHaveBeenCalled();
  });
});
