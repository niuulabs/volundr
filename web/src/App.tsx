import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/auth';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { volundrService } from '@/adapters';
import styles from './App.module.css';

const VolundrPage = lazy(() => import('@/pages/Volundr').then(m => ({ default: m.VolundrPage })));
const VolundrPopout = lazy(() =>
  import('@/pages/Volundr/VolundrPopout').then(m => ({ default: m.VolundrPopout }))
);
const SettingsPage = lazy(() =>
  import('@/pages/Settings').then(m => ({ default: m.SettingsPage }))
);
const AdminPage = lazy(() => import('@/pages/Admin').then(m => ({ default: m.AdminPage })));

function PageLoader() {
  return (
    <div className={styles.pageLoader}>
      <div className={styles.pageLoaderSpinner} />
      <span>Loading...</span>
    </div>
  );
}

function AppContent() {
  return (
    <div className={styles.app}>
      <main className={styles.main}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<VolundrPage />} />
            <Route path="/volundr" element={<VolundrPage />} />
            <Route path="/settings" element={<SettingsPage service={volundrService} />} />
            <Route path="/admin" element={<AdminPage service={volundrService} />} />
            <Route path="/integrations" element={<Navigate to="/settings" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
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
