import { Workflow } from 'lucide-react';
import { registerProductModule } from '@/modules/shared/registry';

registerProductModule({
  key: 'tyr',
  label: 'Tyr',
  icon: Workflow,
  basePath: '/tyr',
  load: () => import('./pages/TyrLayout').then(m => ({ default: m.TyrLayout })),
});
