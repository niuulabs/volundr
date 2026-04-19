/**
 * useWorkflows — React Query wrapper for IWorkflowService.listWorkflows().
 *
 * Owner: plugin-tyr.
 */

import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { IWorkflowService } from '../ports';

export function useWorkflows() {
  const svc = useService<IWorkflowService>('workflows');
  return useQuery({
    queryKey: ['tyr', 'workflows'],
    queryFn: () => svc.listWorkflows(),
  });
}

export function useWorkflow(id: string) {
  const svc = useService<IWorkflowService>('workflows');
  return useQuery({
    queryKey: ['tyr', 'workflows', id],
    queryFn: () => svc.getWorkflow(id),
    enabled: !!id,
  });
}
