import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore, useEncoderStore, useScannerStore } from '../store';
import type { ECCLevel, CameraResolution } from '../types';
import { buildServerEndpoint, resolveServerBaseUrl } from '../services/syncUrl';
import { buildServerAuthHeaders } from '../services/serverAuth';
import { fetchServerWithTimeout } from '../services/serverFetch';
import { useServerAuthState } from './useServerAuthState';
import { createLogger } from '../utils/logger';
import { migrateLegacyEncoderDefaults } from '../utils/encoderConfig';

const logger = createLogger('hooks:settingsSync');

interface SyncedSettings {
  encoder?: {
    fps?: number;
    packetSize?: number;
    ecc?: ECCLevel;
    targetSize?: number;
    raptorqOverhead?: number;
    compressionEnabled?: boolean;
    forceChunkMode?: boolean;
  };
  scanner?: {
    scanInterval?: number;
    resolution?: CameraResolution;
    enableTorch?: boolean;
    tryHarder?: boolean;
  };
  theme?: 'light' | 'dark' | 'system';
}

export function useSettingsSync() {
  const { uploadConfig, theme, setTheme } = useSettingsStore();
  const encoderConfig = useEncoderStore((s) => s.config);
  const setEncoderConfig = useEncoderStore((s) => s.setConfig);
  const scannerConfig = useScannerStore((s) => s.config);
  const setScannerConfig = useScannerStore((s) => s.setConfig);
  const { authReady } = useServerAuthState(uploadConfig);

  const isLoadingRef = useRef(false);
  const hasLoadedRef = useRef(false); // Track if we've already loaded for this session
  const lastSyncedEncoderRef = useRef<string>('');
  const lastSyncedScannerRef = useRef<string>('');
  const lastSyncedThemeRef = useRef<string>('');
  const initialLoadDoneRef = useRef(false);

  // Store refs for current config values (to avoid stale closures)
  const encoderConfigRef = useRef(encoderConfig);
  const scannerConfigRef = useRef(scannerConfig);
  encoderConfigRef.current = encoderConfig;
  scannerConfigRef.current = scannerConfig;

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return buildServerAuthHeaders(uploadConfig, 'application/json');
  }, [uploadConfig]);

  useEffect(() => {
    hasLoadedRef.current = false;
    isLoadingRef.current = false;
  }, [uploadConfig.url, uploadConfig.apiKey, uploadConfig.username, uploadConfig.password]);

  // Load settings from server - only depends on URL/auth, not on config values
  const loadSettings = useCallback(async () => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;
    if (isLoadingRef.current) return;
    if (hasLoadedRef.current) return; // Already loaded this session

    const baseUrl = resolveServerBaseUrl(uploadConfig.url);
    if (!baseUrl) {
      return;
    }

    isLoadingRef.current = true;

    try {
      const response = await fetchServerWithTimeout(buildServerEndpoint(baseUrl, 'api/config/settings'), {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const settings: SyncedSettings = await response.json();
        const currentEncoder = encoderConfigRef.current;
        const currentScanner = scannerConfigRef.current;

        // Apply encoder settings
        if (settings.encoder && Object.keys(settings.encoder).length > 0) {
          setEncoderConfig(migrateLegacyEncoderDefaults({
            fps: settings.encoder.fps ?? currentEncoder.fps,
            packetSize: settings.encoder.packetSize ?? currentEncoder.packetSize,
            ecc: settings.encoder.ecc ?? currentEncoder.ecc,
            targetSize: settings.encoder.targetSize ?? currentEncoder.targetSize,
            raptorqOverhead: settings.encoder.raptorqOverhead ?? currentEncoder.raptorqOverhead,
            compressionEnabled: settings.encoder.compressionEnabled ?? currentEncoder.compressionEnabled,
            forceChunkMode: settings.encoder.forceChunkMode ?? currentEncoder.forceChunkMode,
          }));
          // Update refs to prevent immediate re-save
          lastSyncedEncoderRef.current = JSON.stringify(settings.encoder);
        }

        // Apply scanner settings
        if (settings.scanner && Object.keys(settings.scanner).length > 0) {
          setScannerConfig({
            scanInterval: settings.scanner.scanInterval ?? currentScanner.scanInterval,
            resolution: settings.scanner.resolution ?? currentScanner.resolution,
            enableTorch: settings.scanner.enableTorch ?? currentScanner.enableTorch,
            tryHarder: settings.scanner.tryHarder ?? currentScanner.tryHarder,
          });
          lastSyncedScannerRef.current = JSON.stringify(settings.scanner);
        }

        // Apply theme
        if (settings.theme) {
          setTheme(settings.theme);
          lastSyncedThemeRef.current = settings.theme;
        }

        hasLoadedRef.current = true;
        initialLoadDoneRef.current = true;
        logger.info("Settings loaded from server");
      }
    } catch (err) {
      // More detailed error logging
      if (err instanceof TypeError) {
        logger.error("Failed to load settings from server (network/CORS error)", {
          error: err instanceof Error ? err.message : String(err),
          message: err.message,
          serverUrl: uploadConfig.url,
          hint: "This may be a mixed-content issue (HTTPS page calling HTTP server)"
        });
      } else {
        logger.error("Failed to load settings from server", { error: err instanceof Error ? err.message : String(err) });
      }
      // Mark as loaded even on error to prevent infinite retries
      hasLoadedRef.current = true;
      initialLoadDoneRef.current = true;
    } finally {
      isLoadingRef.current = false;
    }
  }, [
    authReady,
    uploadConfig.enabled,
    uploadConfig.url,
    getAuthHeaders,
    setEncoderConfig,
    setScannerConfig,
    setTheme,
  ]);

  // Save settings to server
  const saveSettings = useCallback(async (partial: Partial<SyncedSettings>) => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;

    const baseUrl = resolveServerBaseUrl(uploadConfig.url);
    if (!baseUrl) {
      return;
    }

    try {
      const response = await fetchServerWithTimeout(buildServerEndpoint(baseUrl, 'api/config/settings'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(partial),
      });

      if (response.ok) {
        logger.info("Settings saved to server", { fields: Object.keys(partial) });
      }
    } catch (err) {
      logger.error("Failed to save settings to server", { error: err instanceof Error ? err.message : String(err) });
    }
  }, [authReady, uploadConfig.enabled, uploadConfig.url, getAuthHeaders]);

  // Store saveSettings in a ref to avoid it being a dependency
  const saveSettingsRef = useRef(saveSettings);
  saveSettingsRef.current = saveSettings;

  // Load settings when sync is first enabled - only run once per URL
  useEffect(() => {
    if (uploadConfig.enabled && uploadConfig.url) {
      // Reset hasLoadedRef if URL changes
      hasLoadedRef.current = false;
      initialLoadDoneRef.current = false;
    }
  }, [uploadConfig.enabled, uploadConfig.url]);

  useEffect(() => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;
    loadSettings();
  }, [uploadConfig.enabled, uploadConfig.url, authReady, loadSettings]);

  // Auto-save encoder settings when they change (debounced)
  useEffect(() => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;
    if (!initialLoadDoneRef.current) return; // Don't save before initial load

    const currentEncoder = {
      fps: encoderConfig.fps,
      packetSize: encoderConfig.packetSize,
      ecc: encoderConfig.ecc,
      targetSize: encoderConfig.targetSize,
      raptorqOverhead: encoderConfig.raptorqOverhead,
      compressionEnabled: encoderConfig.compressionEnabled,
      forceChunkMode: encoderConfig.forceChunkMode,
    };
    const configStr = JSON.stringify(currentEncoder);
    if (lastSyncedEncoderRef.current === configStr) return;

    // Debounce - wait a bit before saving
    const timeout = setTimeout(() => {
      lastSyncedEncoderRef.current = configStr;
      saveSettingsRef.current({ encoder: currentEncoder });
    }, 1000);

    return () => clearTimeout(timeout);
  }, [authReady, uploadConfig.enabled, uploadConfig.url, encoderConfig.fps, encoderConfig.packetSize, encoderConfig.ecc, encoderConfig.targetSize, encoderConfig.raptorqOverhead, encoderConfig.compressionEnabled, encoderConfig.forceChunkMode]);

  // Auto-save scanner settings when they change (debounced)
  useEffect(() => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;
    if (!initialLoadDoneRef.current) return;

    const currentScanner = {
      scanInterval: scannerConfig.scanInterval,
      resolution: scannerConfig.resolution,
      enableTorch: scannerConfig.enableTorch,
      tryHarder: scannerConfig.tryHarder,
    };
    const configStr = JSON.stringify(currentScanner);
    if (lastSyncedScannerRef.current === configStr) return;

    const timeout = setTimeout(() => {
      lastSyncedScannerRef.current = configStr;
      saveSettingsRef.current({ scanner: currentScanner });
    }, 1000);

    return () => clearTimeout(timeout);
  }, [authReady, uploadConfig.enabled, uploadConfig.url, scannerConfig.scanInterval, scannerConfig.resolution, scannerConfig.enableTorch, scannerConfig.tryHarder]);

  // Auto-save theme when it changes (debounced)
  useEffect(() => {
    if (!uploadConfig.enabled || !uploadConfig.url) return;
    if (!authReady) return;
    if (!initialLoadDoneRef.current) return;
    if (lastSyncedThemeRef.current === theme) return;

    const timeout = setTimeout(() => {
      lastSyncedThemeRef.current = theme;
      saveSettingsRef.current({ theme });
    }, 500);

    return () => clearTimeout(timeout);
  }, [authReady, uploadConfig.enabled, uploadConfig.url, theme]);

  return { loadSettings, saveSettings };
}
