import { useParams } from '@tanstack/react-router';
import { SessionDetailPage } from './SessionDetailPage';

export function VolundrSessionRoute() {
  const { sessionId } = useParams({ strict: false });
  return <SessionDetailPage sessionId={sessionId as string} />;
}

export function VolundrArchivedRoute() {
  const { sessionId } = useParams({ strict: false });
  return <SessionDetailPage sessionId={sessionId as string} readOnly />;
}
