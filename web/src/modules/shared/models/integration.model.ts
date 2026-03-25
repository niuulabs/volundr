export interface IntegrationConnection {
  id: string;
  integrationType: string;
  adapter: string;
  credentialName: string;
  config: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  slug: string;
}
