import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { IBudgetStream } from '../ports';

export function useFleetBudget() {
  const service = useService<IBudgetStream>('ravn.budget');
  return useQuery({
    queryKey: ['ravn', 'budget', 'fleet'],
    queryFn: () => service.getFleetBudget(),
  });
}

export function useRavnBudget(ravnId: string) {
  const service = useService<IBudgetStream>('ravn.budget');
  return useQuery({
    queryKey: ['ravn', 'budget', ravnId],
    queryFn: () => service.getBudget(ravnId),
    enabled: Boolean(ravnId),
  });
}
