import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntegrationCard } from './IntegrationCard';
import type { CatalogEntry, IntegrationConnection } from '@/modules/volundr/models';

const mockCatalogEntry: CatalogEntry = {
  slug: 'linear',
  name: 'Linear',
  description: 'Issue tracker',
  integration_type: 'issue_tracker',
  adapter: 'volundr.adapters.outbound.linear.LinearAdapter',
  icon: 'linear',
  credential_schema: {
    required: ['api_key'],
    properties: { api_key: { type: 'string' } },
  },
  config_schema: {},
  mcp_server: {
    name: 'linear-mcp',
    command: 'npx',
    args: ['-y', '@anthropic-ai/linear-mcp-server'],
    env_from_credentials: { LINEAR_API_KEY: 'api_key' },
  },
  auth_type: 'api_key',
  oauth_scopes: [],
};

const mockConnection: IntegrationConnection = {
  id: 'int-1',
  integrationType: 'issue_tracker',
  adapter: 'volundr.adapters.outbound.linear.LinearAdapter',
  credentialName: 'linear-key',
  config: {},
  enabled: true,
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z',
  slug: 'linear',
};

describe('IntegrationCard', () => {
  it('renders catalog entry name', () => {
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={vi.fn()} />);
    expect(screen.getByText('Linear')).toBeDefined();
  });

  it('renders description', () => {
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={vi.fn()} />);
    expect(screen.getByText('Issue tracker')).toBeDefined();
  });

  it('renders type badge', () => {
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={vi.fn()} />);
    expect(screen.getByText('Issue Tracker')).toBeDefined();
  });

  it('renders MCP badge when entry has mcp_server', () => {
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={vi.fn()} />);
    expect(screen.getByText('MCP')).toBeDefined();
  });

  it('does not render MCP badge when entry has no mcp_server', () => {
    const noMcp = { ...mockCatalogEntry, mcp_server: null };
    render(<IntegrationCard entry={noMcp} onConnect={vi.fn()} />);
    expect(screen.queryByText('MCP')).toBeNull();
  });

  it('shows Connect button when not connected', () => {
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={vi.fn()} />);
    expect(screen.getByText('Connect')).toBeDefined();
  });

  it('calls onConnect when Connect button clicked', () => {
    const onConnect = vi.fn();
    render(<IntegrationCard entry={mockCatalogEntry} onConnect={onConnect} />);
    fireEvent.click(screen.getByText('Connect'));
    expect(onConnect).toHaveBeenCalledWith(mockCatalogEntry);
  });

  it('shows Connected status when connection is enabled', () => {
    render(
      <IntegrationCard entry={mockCatalogEntry} connection={mockConnection} onConnect={vi.fn()} />
    );
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('shows Disabled status when connection is disabled', () => {
    const disabled = { ...mockConnection, enabled: false };
    render(<IntegrationCard entry={mockCatalogEntry} connection={disabled} onConnect={vi.fn()} />);
    expect(screen.getByText('Disabled')).toBeDefined();
  });

  it('shows credential name when connected', () => {
    render(
      <IntegrationCard entry={mockCatalogEntry} connection={mockConnection} onConnect={vi.fn()} />
    );
    expect(screen.getByText('Credential: linear-key')).toBeDefined();
  });

  it('shows Test and Disconnect buttons when connected', () => {
    render(
      <IntegrationCard
        entry={mockCatalogEntry}
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onTest={vi.fn()}
      />
    );
    expect(screen.getByText('Test')).toBeDefined();
    expect(screen.getByText('Disconnect')).toBeDefined();
  });

  it('calls onDisconnect when Disconnect clicked', () => {
    const onDisconnect = vi.fn();
    render(
      <IntegrationCard
        entry={mockCatalogEntry}
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );
    fireEvent.click(screen.getByText('Disconnect'));
    expect(onDisconnect).toHaveBeenCalledWith('int-1');
  });

  it('calls onTest when Test clicked', () => {
    const onTest = vi.fn();
    render(
      <IntegrationCard
        entry={mockCatalogEntry}
        connection={mockConnection}
        onConnect={vi.fn()}
        onTest={onTest}
      />
    );
    fireEvent.click(screen.getByText('Test'));
    expect(onTest).toHaveBeenCalledWith('int-1');
  });
});
