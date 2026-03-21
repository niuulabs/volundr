import { NavLink, useLocation } from 'react-router-dom';
import { Settings, Shield } from 'lucide-react';
import { getProductModules } from '@/modules/shared/registry';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  isAdmin?: boolean;
}

export function Sidebar({ isAdmin = false }: SidebarProps) {
  const location = useLocation();
  const productModules = getProductModules();

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
      </div>
    </nav>
  );
}
