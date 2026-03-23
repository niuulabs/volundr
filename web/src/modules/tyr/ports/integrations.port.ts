export interface TyrIntegrationConnection {
  id: string;
  integration_type: string;
  adapter: string;
  credential_name: string;
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TelegramSetupResult {
  deeplink: string;
  token: string;
}

export interface ITyrIntegrationService {
  listIntegrations(): Promise<TyrIntegrationConnection[]>;
  createIntegration(params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }): Promise<TyrIntegrationConnection>;
  deleteIntegration(id: string): Promise<void>;
  toggleIntegration(id: string, enabled: boolean): Promise<TyrIntegrationConnection>;
  getTelegramSetup(): Promise<TelegramSetupResult>;
}
