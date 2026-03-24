import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { ITyrIntegrationService, TelegramSetupResult } from '../../ports';

export class MockTyrIntegrationService implements ITyrIntegrationService {
  private connections: IntegrationConnection[] = [];

  async listIntegrations(): Promise<IntegrationConnection[]> {
    return [...this.connections];
  }

  async createIntegration(params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }): Promise<IntegrationConnection> {
    const connection: IntegrationConnection = {
      id: crypto.randomUUID(),
      integrationType: params.integration_type,
      adapter: params.adapter,
      credentialName: params.credential_name,
      config: params.config,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slug: params.integration_type.replace(/_/g, '-'),
    };
    this.connections.push(connection);
    return connection;
  }

  async deleteIntegration(id: string): Promise<void> {
    this.connections = this.connections.filter(c => c.id !== id);
  }

  async toggleIntegration(id: string, enabled: boolean): Promise<IntegrationConnection> {
    const connection = this.connections.find(c => c.id === id);
    if (!connection) {
      throw new Error(`Integration ${id} not found`);
    }
    connection.enabled = enabled;
    connection.updatedAt = new Date().toISOString();
    return { ...connection };
  }

  async getTelegramSetup(): Promise<TelegramSetupResult> {
    return {
      deeplink: 'https://t.me/mock_tyr_bot?start=mock_token_123',
      token: 'mock_token_123',
    };
  }
}
