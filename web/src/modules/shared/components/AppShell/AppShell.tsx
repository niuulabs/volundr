import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

export interface AppShellProps {
  children: ReactNode;
  isAdmin?: boolean;
}

export function AppShell({ children, isAdmin = false }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Sidebar isAdmin={isAdmin} />
      <main className={styles.content}>{children}</main>
    </div>
  );
}
