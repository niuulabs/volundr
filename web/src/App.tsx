import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/auth';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useIdentity } from '@/hooks/useIdentity';
import { volundrService } from '@/modules/volundr/adapters';
import { AppShell } from '@/modules/shared/components/AppShell';
// Initialize module registry (registers all built-in feature modules)
import '@/modules';
import styles from './App.module.css';

const VolundrPage = lazy(() =>
  import('@/modules/volundr/pages/Volundr').then(m => ({ default: m.VolundrPage }))
);
const VolundrPopout = lazy(() =>
  import('@/modules/volundr/pages/Volundr/VolundrPopout').then(m => ({ default: m.VolundrPopout }))
);
const SettingsPage = lazy(() =>
  import('@/modules/volundr/pages/Settings').then(m => ({ default: m.SettingsPage }))
);
const AdminPage = lazy(() =>
  import('@/modules/volundr/pages/Admin').then(m => ({ default: m.AdminPage }))
);
const TyrLayout = lazy(() =>
  import('@/modules/tyr/pages/TyrLayout').then(m => ({ default: m.TyrLayout }))
);

function PageLoader() {
  return (
    <div className={styles.pageLoader}>
      <div className={styles.pageLoaderSpinner} />
      <span>Loading...</span>
    </div>
  );
}

function AppContent() {
  const { isAdmin } = useIdentity(volundrService);

  return (
    <AppShell isAdmin={isAdmin}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/volundr" replace />} />
          <Route path="/volundr" element={<VolundrPage />} />
          <Route path="/tyr/*" element={<TyrLayout />} />
          <Route path="/settings" element={<SettingsPage service={volundrService} />} />
          <Route path="/admin" element={<AdminPage service={volundrService} />} />
          <Route path="/integrations" element={<Navigate to="/settings" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/volundr/popout" element={<VolundrPopout />} />
              <Route path="/popout" element={<VolundrPopout />} />
              <Route path="/*" element={<AppContent />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
