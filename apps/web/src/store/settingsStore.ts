/**
 * Zustand store for settings state management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LoggingConfigUpdate, ScanUploadConfig, SettingsStore } from '../types';
import { STORAGE_KEYS } from '../constants';
import i18n from '../i18n';
import { asWireString } from '../parse/wire';
import { setEnabledModules, setLogLevel } from '../utils/logger';

type DevelopmentSyncEnv = {
  DEV?: boolean;
  VITE_AIRQR_DEV_SYNC_URL?: string;
  VITE_AIRQR_DEV_SYNC_USERNAME?: string;
  VITE_AIRQR_DEV_SYNC_PASSWORD?: string;
};

export const DEFAULT_UPLOAD_CONFIG: ScanUploadConfig = {
  enabled: false,
  url: '',
  apiKey: '',
  username: '',
  password: '',
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

function readEnvValue(env: DevelopmentSyncEnv, key: keyof DevelopmentSyncEnv): string {
  return asWireString(env[key])?.trim() ?? '';
}

export function applyDevelopmentSyncConfig(
  config: ScanUploadConfig,
  env: DevelopmentSyncEnv = import.meta.env
): ScanUploadConfig {
  if (!env.DEV) {
    return config;
  }

  const url = readEnvValue(env, 'VITE_AIRQR_DEV_SYNC_URL');
  const username = readEnvValue(env, 'VITE_AIRQR_DEV_SYNC_USERNAME');
  const password = readEnvValue(env, 'VITE_AIRQR_DEV_SYNC_PASSWORD');

  if (!url && !username && !password) {
    return config;
  }

  return {
    ...config,
    enabled: true,
    url: url || config.url,
    username: username || config.username,
    password: password || config.password,
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // Initial state
      activeTab: 0,
      theme: 'system',
      language: 'en',
      showEncoderLinksiteNotice: true,
      defaultCameraId: null,
      uploadConfig: applyDevelopmentSyncConfig(DEFAULT_UPLOAD_CONFIG),
      loggingConfig: {
        level: 'info' as const,
        enabledCategories: {
          services: true,
          workers: true,
          hooks: true,
          scanner: true,
          ui: true,
          app: true,
        },
      },
      debugInfo: {
        browserVersion: '',
        userAgent: '',
        platform: '',
        cores: 0,
        memory: 0,
        webgl: false,
        webrtc: false,
        webworker: false,
        wasm: false,
        indexedDB: false,
        localStorage: false,
        sessionStorage: false,
        cookies: false,
        cacheStorage: false,
      },
      storageStats: null,
      isSharing: false,
      shareError: null,

      // Actions
      setActiveTab: (tab) => set({ activeTab: tab }),
      setTheme: (theme) => {
        set({ theme });
        // Apply theme to document
        if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      },
      setLanguage: (language) => {
        set({ language });
        i18n.changeLanguage(language);
        localStorage.setItem('airqr_language', language);
      },
      setShowEncoderLinksiteNotice: (showEncoderLinksiteNotice) => set({ showEncoderLinksiteNotice }),
      setDefaultCameraId: (cameraId) => set({ defaultCameraId: cameraId }),
      setUploadConfig: (config) =>
        set((state) => ({
          uploadConfig: {
            ...state.uploadConfig,
            ...config,
          },
        })),
      setDebugInfo: (info) => set({ debugInfo: info }),
      setStorageStats: (stats) => set({ storageStats: stats }),
      setSharing: (isSharing, error = null) => set({ isSharing, shareError: error }),
      setLoggingConfig: (config: LoggingConfigUpdate) =>
        set((state) => {
          const newConfig = {
            ...state.loggingConfig,
            ...config,
            enabledCategories: config.enabledCategories
              ? { ...state.loggingConfig.enabledCategories, ...config.enabledCategories }
              : state.loggingConfig.enabledCategories,
          };
          const enabled: string[] = [];
          if (newConfig.enabledCategories.services) enabled.push('services:*');
          if (newConfig.enabledCategories.workers) enabled.push('workers:*');
          if (newConfig.enabledCategories.hooks) enabled.push('hooks:*');
          if (newConfig.enabledCategories.scanner) enabled.push('scanner:*');
          if (newConfig.enabledCategories.ui) enabled.push('ui:*');
          if (newConfig.enabledCategories.app) enabled.push('app:*');

          setLogLevel(newConfig.level);
          setEnabledModules(enabled.length === 6 ? '*' : enabled);
          return { loggingConfig: newConfig };
        }),

      // Storage management
      clearAppData: async () => {
        try {
          // Clear localStorage
          const themeBackup = localStorage.getItem('theme');
          localStorage.clear();
          if (themeBackup) {
            localStorage.setItem('theme', themeBackup);
          }

          // Clear sessionStorage
          sessionStorage.clear();

          // Clear IndexedDB
          const databases = await indexedDB.databases();
          for (const db of databases) {
            if (db.name) {
              await indexedDB.deleteDatabase(db.name);
            }
          }

          // Clear cache storage
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
          }

          // Reset stores but keep theme
          set((state) => ({
            ...state,
            storageStats: null,
          }));

          return true;
        } catch (error) {
          console.error('Error clearing app data:', error);
          return false;
        }
      },
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      partialize: (state) => ({
        activeTab: state.activeTab,
        theme: state.theme,
        language: state.language,
        showEncoderLinksiteNotice: state.showEncoderLinksiteNotice,
        defaultCameraId: state.defaultCameraId,
        uploadConfig: state.uploadConfig,
        loggingConfig: state.loggingConfig,
      }),
      merge: (persistedState, currentState) => {
        // SAFETY: zustand persist merge receives this store's partialize snapshot.
        const persisted = persistedState as Partial<SettingsStore> | undefined;
        return {
          ...currentState,
          ...persisted,
          uploadConfig: applyDevelopmentSyncConfig({
            ...currentState.uploadConfig,
            ...persisted?.uploadConfig,
          }),
          loggingConfig: {
            ...currentState.loggingConfig,
            ...persisted?.loggingConfig,
          },
        };
      },
    }
  )
);
