import type { IntegrationConnection } from '@/modules/shared/models/integration.model';

export type { IntegrationConnection } from '@/modules/shared/models/integration.model';

export interface TelegramSetupResult {
  deeplink: string;
  token: string;
}

export interface CreateIntegrationParams {
  integrationType: string;
  adapter: string;
  credentialName: string;
  credentialValue: string;
  config: Record<string, string>;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface ITyrIntegrationService {
  listIntegrations(): Promise<IntegrationConnection[]>;
  createIntegration(params: CreateIntegrationParams): Promise<IntegrationConnection>;
  deleteIntegration(id: string): Promise<void>;
  toggleIntegration(id: string, enabled: boolean): Promise<IntegrationConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  getTelegramSetup(): Promise<TelegramSetupResult>;
}
