import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { PortsProvider, type InstancePorts } from '@/contexts/PortsContext';
import { InstanceSwitcher } from './components/InstanceSwitcher/InstanceSwitcher';
import { GraphPage } from './pages/GraphPage';
import { BrowserPage } from './pages/BrowserPage';
import { IngestPage } from './pages/IngestPage';
import { LogPage } from './pages/LogPage';
import { LintPage } from './pages/LintPage';
import { SettingsPage } from './pages/SettingsPage';
import styles from './App.module.css';

interface AppProps {
  instances: InstancePorts[];
  defaultInstanceName: string;
}

export function App({ instances, defaultInstanceName }: AppProps) {
  const [activeInstanceName, setActiveInstanceName] = useState(defaultInstanceName);

  const switcherInstances = instances.map((ip) => ({
    name: ip.instance.name,
    role: ip.instance.role,
    writeEnabled: ip.instance.writeEnabled,
  }));

  const portsValue = {
    instances,
    activeInstanceName,
    setActiveInstanceName,
  };

  return (
    <PortsProvider value={portsValue}>
      <BrowserRouter>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.brand}>
              <span className={styles.rune}>ᛗ</span>
              <span className={styles.brandName}>Mímir</span>
            </div>
            <InstanceSwitcher
              instances={switcherInstances}
              activeName={activeInstanceName}
              onChange={setActiveInstanceName}
            />
            <nav className={styles.nav}>
              <NavLink to="/graph" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Graph
              </NavLink>
              <NavLink to="/browse" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Browse
              </NavLink>
              <NavLink to="/ingest" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Ingest
              </NavLink>
              <NavLink to="/log" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Log
              </NavLink>
              <NavLink to="/lint" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Lint
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
                Settings
              </NavLink>
            </nav>
          </header>
          <main className={styles.main}>
            <Routes>
              <Route path="/" element={<Navigate to="/graph" replace />} />
              <Route path="/graph" element={<GraphPage />} />
              <Route path="/browse" element={<BrowserPage />} />
              <Route path="/ingest" element={<IngestPage />} />
              <Route path="/log" element={<LogPage />} />
              <Route path="/lint" element={<LintPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </PortsProvider>
  );
}
