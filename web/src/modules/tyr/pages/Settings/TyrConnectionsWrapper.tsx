import type { IVolundrService } from '@/modules/volundr/ports';
import { tyrIntegrationService } from '@/modules/tyr/adapters';
import { TyrSettings } from './TyrSettings';

// Wrapper typed for the module registry; internally uses tyrIntegrationService
export function TyrConnectionsWrapper(_props: { service: IVolundrService }) {
  return <TyrSettings service={tyrIntegrationService} />;
}
