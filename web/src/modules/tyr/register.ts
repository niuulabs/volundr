import { Compass } from 'lucide-react';
import { registerProductModule } from '@/modules/shared/registry';

registerProductModule({
  key: 'tyr',
  label: 'Tyr',
  icon: Compass,
  basePath: '/tyr',
  load: () => import('./pages/TyrLayout').then(m => ({ default: m.TyrLayout })),
});
