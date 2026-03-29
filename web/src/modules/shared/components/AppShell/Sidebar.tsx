import { NavLink, useLocation } from 'react-router-dom';
import { Settings, Shield, LogOut } from 'lucide-react';
import { getProductModules } from '@/modules/shared/registry';
import { cn } from '@/modules/shared/utils/classnames';
import { useAuth } from '@/auth';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  isAdmin?: boolean;
}

export function Sidebar({ isAdmin = false }: SidebarProps) {
  const location = useLocation();
  const productModules = getProductModules();
  const { enabled: authEnabled, logout } = useAuth();

  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      <div className={styles.topSection}>
        {productModules.map(mod => {
          const Icon = mod.icon;
          const isActive = location.pathname.startsWith(mod.basePath);

          return (
            <NavLink
              key={mod.key}
              to={mod.basePath}
              className={cn(styles.navItem, isActive && styles.navItemActive)}
              data-tooltip={mod.label}
            >
              <Icon className={styles.navIcon} />
            </NavLink>
          );
        })}
      </div>

      <div className={styles.divider} />

      <div className={styles.bottomSection}>
        <NavLink
          to="/settings"
          className={cn(
            styles.navItem,
            location.pathname.startsWith('/settings') && styles.navItemActive
          )}
          data-tooltip="Settings"
        >
          <Settings className={styles.navIcon} />
        </NavLink>

        {isAdmin && (
          <NavLink
            to="/admin"
            className={cn(
              styles.navItem,
              location.pathname.startsWith('/admin') && styles.navItemActive
            )}
            data-tooltip="Admin"
          >
            <Shield className={styles.navIcon} />
          </NavLink>
        )}

        {authEnabled && (
          <button type="button" className={styles.navItem} data-tooltip="Sign out" onClick={logout}>
            <LogOut className={styles.navIcon} />
          </button>
        )}

        <div className={styles.version}>{__APP_VERSION__}</div>
      </div>
    </nav>
  );
}
