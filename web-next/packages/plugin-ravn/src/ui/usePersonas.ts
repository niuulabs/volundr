import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { IRavnService } from '../ports';
import type { PersonaFilter } from '../domain';

export function usePersonas(filter: PersonaFilter = 'all') {
  const service = useService<IRavnService>('ravn');
  return useQuery({
    queryKey: ['ravn', 'personas', filter],
    queryFn: () => service.personas.listPersonas(filter),
  });
}
