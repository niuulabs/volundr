import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { ITyrService } from '../ports';
import type { Raid, Phase, Saga } from '../domain/saga';

export interface DispatchEntry {
  raid: Raid;
  phase: Phase;
  saga: Saga;
  /** All phases for the saga — used by the upstream-blocked gate. */
  allPhases: Phase[];
}

/** Returns all pending/queued/running raids across active sagas. */
export function useDispatchQueue() {
  const tyr = useService<ITyrService>('tyr');

  return useQuery({
    queryKey: ['tyr', 'dispatch-queue'],
    queryFn: async (): Promise<DispatchEntry[]> => {
      const sagas = await tyr.getSagas();
      const activeSagas = sagas.filter((s) => s.status === 'active');

      const results = await Promise.all(
        activeSagas.map(async (saga) => {
          const phases = await tyr.getPhases(saga.id);
          return phases.flatMap((phase) =>
            phase.raids.map((raid) => ({ raid, phase, saga, allPhases: phases })),
          );
        }),
      );

      return results.flat();
    },
  });
}
