import { createApiClient } from '@/modules/shared/api/client';
import type {
  ITyrIntegrationService,
  TyrIntegrationConnection,
  TelegramSetupResult,
} from '../../ports/integrations.port';

const integrationsApi = createApiClient('/api/v1/tyr/integrations');
const telegramApi = createApiClient('/api/v1/tyr/telegram');

export class ApiTyrIntegrationService implements ITyrIntegrationService {
  async listIntegrations(): Promise<TyrIntegrationConnection[]> {
    return integrationsApi.get<TyrIntegrationConnection[]>('');
  }

  async createIntegration(params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }): Promise<TyrIntegrationConnection> {
    return integrationsApi.post<TyrIntegrationConnection>('', params);
  }

  async deleteIntegration(id: string): Promise<void> {
    await integrationsApi.delete(`/${id}`);
  }

  async toggleIntegration(id: string, enabled: boolean): Promise<TyrIntegrationConnection> {
    return integrationsApi.patch<TyrIntegrationConnection>(`/${id}`, { enabled });
  }

  async getTelegramSetup(): Promise<TelegramSetupResult> {
    return telegramApi.get<TelegramSetupResult>('/setup');
  }
}
