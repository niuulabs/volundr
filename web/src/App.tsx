import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/auth';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { IdentityProvider } from '@/contexts/IdentityContext';
import { useAppIdentity } from '@/contexts/useAppIdentity';
import { AppShell } from '@/modules/shared/components/AppShell';
import { ModuleRoutes } from '@/modules/shared/components/ModuleRouter';
// Initialize module registry (registers all built-in feature modules)
import '@/modules';
import styles from './App.module.css';

// Shared pages that exist outside the module system
const VolundrPopout = lazy(() =>
  import('@/modules/volundr/pages/Volundr/VolundrPopout').then(m => ({ default: m.VolundrPopout }))
);
const SettingsPage = lazy(() =>
  import('@/modules/volundr/pages/Settings').then(m => ({ default: m.SettingsPage }))
);
const AdminPage = lazy(() =>
  import('@/modules/volundr/pages/Admin').then(m => ({ default: m.AdminPage }))
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
  const { isAdmin } = useAppIdentity();

  return (
    <AppShell isAdmin={isAdmin}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/volundr" replace />} />
          {ModuleRoutes()}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
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
          <IdentityProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/volundr/popout" element={<VolundrPopout />} />
                <Route path="/popout" element={<VolundrPopout />} />
                <Route path="/*" element={<AppContent />} />
              </Routes>
            </Suspense>
          </IdentityProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
