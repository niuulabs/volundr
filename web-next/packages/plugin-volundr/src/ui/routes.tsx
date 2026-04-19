import { useParams } from '@tanstack/react-router';
import { VolundrSessionPage } from './VolundrSessionPage';

export function VolundrSessionRoute() {
  const { sessionId } = useParams({ strict: false });
  return <VolundrSessionPage sessionId={sessionId as string} />;
}

export function VolundrArchivedRoute() {
  const { sessionId } = useParams({ strict: false });
  return <VolundrSessionPage sessionId={sessionId as string} readOnly />;
}
