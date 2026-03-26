import { NavLink, Outlet } from 'react-router-dom';
import { ScrollText, PlusCircle, Radio, Monitor, Download, LayoutDashboard } from 'lucide-react';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './TyrLayout.module.css';

const navItems = [
  { to: '/tyr/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tyr/sagas', label: 'Sagas', icon: ScrollText },
  { to: '/tyr/new', label: 'New Saga', icon: PlusCircle },
  { to: '/tyr/import', label: 'Import', icon: Download },
  { to: '/tyr/dispatcher', label: 'Dispatcher', icon: Radio },
  { to: '/tyr/sessions', label: 'Sessions', icon: Monitor },
];

export function TyrLayout() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <h2 className={styles.title}>Tyr</h2>
        <nav className={styles.nav}>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
              >
                <Icon className={styles.navIcon} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
