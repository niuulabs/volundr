import type { IntegrationConnection } from '@/modules/shared/models/integration.model';

export type { IntegrationConnection } from '@/modules/shared/models/integration.model';

export interface TelegramSetupResult {
  deeplink: string;
  token: string;
}

export interface ITyrIntegrationService {
  listIntegrations(): Promise<IntegrationConnection[]>;
  createIntegration(params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }): Promise<IntegrationConnection>;
  deleteIntegration(id: string): Promise<void>;
  toggleIntegration(id: string, enabled: boolean): Promise<IntegrationConnection>;
  getTelegramSetup(): Promise<TelegramSetupResult>;
}
