import type {
  ITyrIntegrationService,
  TyrIntegrationConnection,
  TelegramSetupResult,
} from '../../ports';

export class MockTyrIntegrationService implements ITyrIntegrationService {
  private connections: TyrIntegrationConnection[] = [];

  async listIntegrations(): Promise<TyrIntegrationConnection[]> {
    return [...this.connections];
  }

  async createIntegration(params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }): Promise<TyrIntegrationConnection> {
    const connection: TyrIntegrationConnection = {
      id: crypto.randomUUID(),
      integration_type: params.integration_type,
      adapter: params.adapter,
      credential_name: params.credential_name,
      config: params.config,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.connections.push(connection);
    return connection;
  }

  async deleteIntegration(id: string): Promise<void> {
    this.connections = this.connections.filter(c => c.id !== id);
  }

  async toggleIntegration(id: string, enabled: boolean): Promise<TyrIntegrationConnection> {
    const connection = this.connections.find(c => c.id === id);
    if (!connection) {
      throw new Error(`Integration ${id} not found`);
    }
    connection.enabled = enabled;
    connection.updated_at = new Date().toISOString();
    return { ...connection };
  }

  async getTelegramSetup(): Promise<TelegramSetupResult> {
    return {
      deeplink: 'https://t.me/mock_tyr_bot?start=mock_token_123',
      token: 'mock_token_123',
    };
  }
}
