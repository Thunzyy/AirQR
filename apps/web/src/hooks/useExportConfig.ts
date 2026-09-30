import { useCallback, useEffect, useRef, useState } from 'react';

import {
  asWireBoolean,
  asWireObject,
  asWireString,
  parseJsonText,
  type WireValue,
} from '../parse/wire';
import {
  buildServerAuthHeaders,
  fetchServerWithTimeout,
} from '../services/serverAuth';
import { buildServerEndpoint } from '../services/syncUrl';
import type { ScanUploadConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('hooks:useExportConfig');

export interface ExportConfig {
  enabled: boolean;
  exportDir: string | null;
  exportScanned: boolean;
  exportGenerated: boolean;
  effectiveDir: string | null;
  exportDirValid?: boolean;
  exportDirError?: string;
}

interface UseExportConfigArgs {
  uploadConfig: ScanUploadConfig;
  storedSyncAuthConfig: Pick<ScanUploadConfig, 'apiKey' | 'username' | 'password'>;
  syncBaseUrl: string | null;
  serverAuthReady: boolean;
}

interface UseExportConfigResult {
  exportConfig: ExportConfig;
  exportDirInput: string;
  setExportDirInput: (value: string) => void;
  exportConfigLoading: boolean;
  exportConfigError: string | null;
  exportConfigSaved: boolean;
  saveExportConfig: (updates: Partial<ExportConfig>) => Promise<void>;
}

const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  enabled: true,
  exportDir: null,
  exportScanned: true,
  exportGenerated: true,
  effectiveDir: null,
};

function normalizeExportConfig(payload: WireValue): ExportConfig {
  const config = asWireObject(payload);

  return {
    enabled: asWireBoolean(config.enabled) ?? true,
    exportDir: asWireString(config.exportDir) ?? null,
    exportScanned: asWireBoolean(config.exportScanned) ?? true,
    exportGenerated: asWireBoolean(config.exportGenerated) ?? true,
    effectiveDir: asWireString(config.effectiveDir) ?? null,
    exportDirValid: asWireBoolean(config.exportDirValid),
    exportDirError: asWireString(config.exportDirError),
  };
}

export function useExportConfig({
  uploadConfig,
  storedSyncAuthConfig,
  syncBaseUrl,
  serverAuthReady,
}: UseExportConfigArgs): UseExportConfigResult {
  const storedApiKey = storedSyncAuthConfig.apiKey;
  const storedUsername = storedSyncAuthConfig.username;
  const storedPassword = storedSyncAuthConfig.password;
  const [exportConfig, setExportConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);
  const [exportDirInput, setExportDirInput] = useState('');
  const [exportConfigLoading, setExportConfigLoading] = useState(false);
  const [exportConfigError, setExportConfigError] = useState<string | null>(null);
  const [exportConfigSaved, setExportConfigSaved] = useState(false);
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSavedReset = useCallback(() => {
    if (savedResetTimerRef.current) {
      clearTimeout(savedResetTimerRef.current);
    }
    savedResetTimerRef.current = setTimeout(() => {
      setExportConfigSaved(false);
      savedResetTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
      }
    };
  }, []);

  const buildStoredSyncHeaders = useCallback(
    (contentType = 'application/json') =>
      buildServerAuthHeaders(
        {
          apiKey: storedApiKey,
          username: storedUsername,
          password: storedPassword,
        },
        contentType
      ),
    [storedApiKey, storedPassword, storedUsername]
  );

  const loadExportConfig = useCallback(async () => {
    if (!uploadConfig.enabled || !uploadConfig.url) {
      return;
    }

    if (!syncBaseUrl) {
      setExportConfigError('Invalid server URL');
      return;
    }

    setExportConfigLoading(true);
    setExportConfigError(null);

    try {
      const response = await fetchServerWithTimeout(
        buildServerEndpoint(syncBaseUrl, 'api/config/export'),
        {
          method: 'GET',
          headers: buildStoredSyncHeaders(),
        }
      );

      if (response.ok) {
        const normalized = normalizeExportConfig(parseJsonText(await response.text()));
        setExportConfig(normalized);
        setExportDirInput(normalized.exportDir || '');
      } else {
        setExportConfigError(`Server error: ${response.status}`);
      }
    } catch {
      setExportConfigError('Could not connect to server');
    } finally {
      setExportConfigLoading(false);
    }
  }, [buildStoredSyncHeaders, syncBaseUrl, uploadConfig.enabled, uploadConfig.url]);

  const saveExportConfig = useCallback(
    async (updates: Partial<ExportConfig>) => {
      if (!uploadConfig.enabled || !uploadConfig.url) {
        return;
      }

      if (!syncBaseUrl) {
        setExportConfigError('Invalid server URL');
        return;
      }

      setExportConfigLoading(true);
      setExportConfigError(null);
      setExportConfigSaved(false);

      try {
        const response = await fetchServerWithTimeout(
      buildServerEndpoint(syncBaseUrl, 'api/config/export'),
          {
            method: 'POST',
            headers: buildStoredSyncHeaders(),
            body: JSON.stringify(updates),
          }
        );

        if (response.ok) {
          const result = asWireObject(parseJsonText(await response.text()));
          if (result.config !== undefined) {
            const normalized = normalizeExportConfig(result.config);
            setExportConfig(normalized);
            setExportDirInput(normalized.exportDir || '');
          }
          setExportConfigSaved(true);
          scheduleSavedReset();
        } else {
          const err = await response.json().catch(() => ({}));
          setExportConfigError(err.error || `Server error: ${response.status}`);
        }
      } catch (error) {
        logger.error('Export config save error', { error: error instanceof Error ? error.message : String(error) });
        setExportConfigError('Could not connect to server');
      } finally {
        setExportConfigLoading(false);
      }
    },
    [
      scheduleSavedReset,
      buildStoredSyncHeaders,
      syncBaseUrl,
      uploadConfig.enabled,
      uploadConfig.url,
    ]
  );

  useEffect(() => {
    if (uploadConfig.enabled && uploadConfig.url && serverAuthReady) {
      void loadExportConfig();
    }
  }, [loadExportConfig, serverAuthReady, uploadConfig.enabled, uploadConfig.url]);

  return {
    exportConfig,
    exportDirInput,
    setExportDirInput,
    exportConfigLoading,
    exportConfigError,
    exportConfigSaved,
    saveExportConfig,
  };
}
