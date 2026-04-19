import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { ISessionStream } from '../../ports';

export function useSessions() {
  const service = useService<ISessionStream>('ravn.sessions');
  return useQuery({
    queryKey: ['ravn', 'sessions'],
    queryFn: () => service.listSessions(),
  });
}

export function useSession(id: string) {
  const service = useService<ISessionStream>('ravn.sessions');
  return useQuery({
    queryKey: ['ravn', 'sessions', id],
    queryFn: () => service.getSession(id),
    enabled: !!id,
  });
}

export function useMessages(sessionId: string) {
  const service = useService<ISessionStream>('ravn.sessions');
  return useQuery({
    queryKey: ['ravn', 'messages', sessionId],
    queryFn: () => service.getMessages(sessionId),
    enabled: !!sessionId,
  });
}
