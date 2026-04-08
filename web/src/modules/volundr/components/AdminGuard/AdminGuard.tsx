import { Navigate } from 'react-router-dom';
import { useAppIdentity } from '@/contexts/useAppIdentity';
import styles from './AdminGuard.module.css';

interface AdminGuardProps {
  children: React.ReactNode;
}

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAdmin, loading } = useAppIdentity();

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
