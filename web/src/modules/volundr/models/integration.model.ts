export type IntegrationType = 'issue_tracker' | 'source_control' | 'messaging' | 'ai_provider';

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

export interface SchemaProperty {
  type: string;
  label?: string;
  default?: string;
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
    properties?: Record<string, SchemaProperty>;
  };
  config_schema?: {
    properties?: Record<string, SchemaProperty>;
  };
  mcp_server: MCPServerSpec | null;
  auth_type: string;
  oauth_scopes: string[];
}
