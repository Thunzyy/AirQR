/**
 * Main App Component - Simplified with Tab Architecture
 */

import { Suspense, lazy, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useSettingsStore } from './store';
import { useHistorySync } from './hooks/useHistorySync';
import { useSettingsSync } from './hooks/useSettingsSync';

// Lazy-loaded tab components (extracted for testability)
import { EncoderTab, DecoderTab, ScannerTab, HistoryTab, SettingsTab, preloadScannerTab } from './lazyTabs';

const BenchmarkPage = lazy(() => import('./components/benchmark/BenchmarkPage'));

import { BottomNav, AppShell } from './components/layout';
import { Toast, ErrorBoundary } from './components/ui';
import { terminateEncoderWorker } from './services/encoderWorkerManager';
import { terminateScanWorker } from './services/scanWorkerManager';

function App() {
  // Location and tab state
  const [location] = useLocation();
  const { activeTab, setActiveTab, theme } = useSettingsStore();
  useHistorySync();
  useSettingsSync();

  // Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Cleanup workers on unmount
  useEffect(() => {
    return () => {
      workerRef.current = null;
      terminateEncoderWorker();
      terminateScanWorker();
    };
  }, []);

  // Apply theme on mount and changes
  useEffect(() => {
    const applyTheme = () => {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Sync active tab with location
  useEffect(() => {
    const pathToTab = {
      '/': 0,
      '/decoder': 1,
      '/scanner': 2,
      '/history': 3,
      '/settings': 4,
    } as const;

    const newTab =
      location === '/' ||
      location === '/decoder' ||
      location === '/scanner' ||
      location === '/history' ||
      location === '/settings'
        ? pathToTab[location]
        : 0;
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
  }, [location, activeTab, setActiveTab]);

  // Warm scanner chunk early so first visit to scanner tab is faster.
  useEffect(() => {
    preloadScannerTab().catch(() => {});
  }, []);

  // Get current tab component
  const getCurrentTab = () => {
    if (location === '/benchmark') {
      return <BenchmarkPage />;
    }

    switch (activeTab) {
      case 0:
        return <EncoderTab workerRef={workerRef} />;
      case 1:
        return <DecoderTab />;
      case 2:
        return <ScannerTab />;
      case 3:
        return <HistoryTab />;
      case 4:
        return <SettingsTab />;
      default:
        return <EncoderTab workerRef={workerRef} />;
    }
  };

  return (
    <AppShell>
      <ErrorBoundary>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center min-h-[60vh]">
            <div className="w-8 h-8 border-2 border-[var(--airqr-loading)] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          {getCurrentTab()}
        </Suspense>
      </ErrorBoundary>
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <Toast />
    </AppShell>
  );
}

export default App;
