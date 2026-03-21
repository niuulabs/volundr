import { Swords } from 'lucide-react';
import { registerProductModule } from '@/modules/shared/registry';

registerProductModule({
  key: 'tyr',
  label: 'Tyr',
  icon: Swords,
  basePath: '/tyr',
  load: () => import('./pages/TyrLayout').then(m => ({ default: m.TyrLayout })),
});
