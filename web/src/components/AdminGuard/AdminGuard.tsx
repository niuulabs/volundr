import { Navigate } from 'react-router-dom';
import { useIdentity } from '@/hooks/useIdentity';
import type { IVolundrService } from '@/ports';
import styles from './AdminGuard.module.css';

interface AdminGuardProps {
  service: IVolundrService;
  children: React.ReactNode;
}

export function AdminGuard({ service, children }: AdminGuardProps) {
  const { isAdmin, loading } = useIdentity(service);

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
