import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './MimirLayout.module.css';

const navItems = [
  { to: 'browse', label: 'Browse' },
  { to: 'graph', label: 'Graph' },
  { to: 'ingest', label: 'Ingest' },
  { to: 'log', label: 'Log' },
  { to: 'lint', label: 'Lint' },
];

export function MimirLayout() {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.rune}>&#x16D7;</span>
          <span className={styles.brandName}>Mimir</span>
        </div>
        <nav className={styles.nav}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(styles.navLink, isActive && styles.navLinkActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
