import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './TyrLayout.module.css';

const tabs = [
  { to: '/tyr/sagas', label: 'Sagas' },
  { to: '/tyr/new', label: 'New Saga' },
  { to: '/tyr/dispatcher', label: 'Dispatcher' },
  { to: '/tyr/sessions', label: 'Sessions' },
];

export function TyrLayout() {
  return (
    <div className={styles.layout}>
      <nav className={styles.tabBar}>
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => cn(styles.tab, isActive && styles.tabActive)}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
