import { Hammer } from 'lucide-react';
import { registerProductModule } from '@/modules/shared/registry';

registerProductModule({
  key: 'volundr',
  label: 'V\u00f6lundr',
  icon: Hammer,
  basePath: '/volundr',
  load: () => import('./pages/Volundr').then(m => ({ default: m.VolundrPage })),
});
