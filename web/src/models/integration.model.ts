export type IntegrationType = 'issue_tracker' | 'source_control' | 'messaging' | 'ai_provider';
export type TrackerProvider = 'linear' | 'jira_cloud' | 'jira_server';

export interface IntegrationConnection {
  id: string;
  integrationType: IntegrationType;
  adapter: string;
  credentialName: string;
  config: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  slug: string;
}

export interface IntegrationTestResult {
  success: boolean;
  provider: string;
  workspace?: string;
  user?: string;
  error?: string;
}

export interface MCPServerSpec {
  name: string;
  command: string;
  args: string[];
  env_from_credentials: Record<string, string>;
}

export interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  integration_type: IntegrationType;
  adapter: string;
  icon: string;
  credential_schema: {
    required?: string[];
    properties?: Record<string, { type: string }>;
  };
  config_schema: {
    properties?: Record<string, { type: string }>;
  };
  mcp_server: MCPServerSpec | null;
  auth_type: string;
  oauth_scopes: string[];
}

export interface TrackerProviderOption {
  id: TrackerProvider;
  name: string;
  adapter: string;
  credentialKeys: string[];
  configFields: { key: string; label: string; placeholder: string }[];
}

export const TRACKER_PROVIDERS: TrackerProviderOption[] = [
  {
    id: 'linear',
    name: 'Linear',
    adapter: 'volundr.adapters.outbound.linear.LinearAdapter',
    credentialKeys: ['api_key'],
    configFields: [],
  },
  {
    id: 'jira_cloud',
    name: 'Jira Cloud',
    adapter: 'volundr.adapters.outbound.jira.JiraAdapter',
    credentialKeys: ['api_token', 'email'],
    configFields: [
      {
        key: 'site_url',
        label: 'Site URL',
        placeholder: 'https://your-org.atlassian.net',
      },
    ],
  },
  {
    id: 'jira_server',
    name: 'Jira Server',
    adapter: 'volundr.adapters.outbound.jira.JiraAdapter',
    credentialKeys: ['api_token', 'email'],
    configFields: [
      {
        key: 'site_url',
        label: 'Server URL',
        placeholder: 'https://jira.company.com',
      },
    ],
  },
];
