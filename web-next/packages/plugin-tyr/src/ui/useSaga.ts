import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { ITyrService } from '../ports';

export function useSaga(id: string) {
  const tyr = useService<ITyrService>('tyr');
  return useQuery({
    queryKey: ['tyr', 'sagas', id],
    queryFn: () => tyr.getSaga(id),
    enabled: !!id,
  });
}
