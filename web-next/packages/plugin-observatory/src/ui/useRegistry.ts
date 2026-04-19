import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { IRegistryRepository } from '../ports/IRegistryRepository';

export function useRegistry() {
  const repo = useService<IRegistryRepository>('observatory.registry');
  return useQuery({
    queryKey: ['observatory', 'registry'],
    queryFn: () => repo.loadRegistry(),
  });
}
