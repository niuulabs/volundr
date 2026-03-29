import { createApiClient } from '@/modules/shared/api/client';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type {
  ITyrIntegrationService,
  TelegramSetupResult,
  CreateIntegrationParams,
  ConnectionTestResult,
} from '../../ports/integrations.port';

const integrationsApi = createApiClient('/api/v1/tyr/integrations');
const telegramApi = createApiClient('/api/v1/tyr/telegram');

interface RawIntegrationConnection {
  id: string;
  integration_type: string;
  adapter: string;
  credential_name: string;
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  slug: string;
}

function mapConnection(raw: RawIntegrationConnection): IntegrationConnection {
  return {
    id: raw.id,
    integrationType: raw.integration_type,
    adapter: raw.adapter,
    credentialName: raw.credential_name,
    config: raw.config,
    enabled: raw.enabled,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    slug: raw.slug,
  };
}

export class ApiTyrIntegrationService implements ITyrIntegrationService {
  async listIntegrations(): Promise<IntegrationConnection[]> {
    const raw = await integrationsApi.get<RawIntegrationConnection[]>('');
    return raw.map(mapConnection);
  }

  async createIntegration(params: CreateIntegrationParams): Promise<IntegrationConnection> {
    const raw = await integrationsApi.post<RawIntegrationConnection>('', {
      integration_type: params.integrationType,
      adapter: params.adapter,
      credential_name: params.credentialName,
      credential_value: params.credentialValue,
      config: params.config,
    });
    return mapConnection(raw);
  }

  async deleteIntegration(id: string): Promise<void> {
    await integrationsApi.delete(`/${id}`);
  }

  async toggleIntegration(id: string, enabled: boolean): Promise<IntegrationConnection> {
    const raw = await integrationsApi.patch<RawIntegrationConnection>(`/${id}`, { enabled });
    return mapConnection(raw);
  }

  async testConnection(id: string): Promise<ConnectionTestResult> {
    return integrationsApi.post<ConnectionTestResult>(`/${id}/test`, {});
  }

  async getTelegramSetup(): Promise<TelegramSetupResult> {
    return telegramApi.get<TelegramSetupResult>('/setup');
  }
}
