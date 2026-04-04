import { tyrIntegrationService } from '@/modules/tyr/adapters';
import { TyrSettings } from './TyrSettings';

export function TyrConnectionsWrapper() {
  return <TyrSettings service={tyrIntegrationService} />;
}
