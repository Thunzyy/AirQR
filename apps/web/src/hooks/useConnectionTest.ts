import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

import type { WireValue } from '../parse/wire';
import { loadHistoryFromIndexedDB } from '../services/historyDB';
import {
  buildServerAuthHeaders,
  fetchServerWithTimeout,
  isServerRequestTimeoutError,
  loginToServerSession,
  logoutFromServerSession,
} from '../services/serverAuth';
import {
  buildServerEndpoint,
  getConnectionFailureTranslationKey,
  getConnectionTimeoutTranslationKey,
  isMixedContentBlocked,
  resolveFetchCredentials,
  resolveSameOriginLocalFallback,
} from '../services/syncUrl';
import type { ScanUploadConfig } from '../types';

export interface SyncActionResult {
  success: boolean;
  message: string;
  kind: 'connection' | 'sync' | 'sign-out' | 'error';
}

export interface SyncStatusBadge {
  label: string;
  className: string;
}

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface UseConnectionTestArgs {
  uploadConfig: ScanUploadConfig;
  setUploadConfig: (config: Partial<ScanUploadConfig>) => void;
  syncBaseUrl: string | null;
  authEnabled: boolean;
  authorized: boolean;
  authStatusChecking: boolean;
  authConnectionError: boolean;
  t: TFunction;
  showToast: (message: string, type?: ToastType) => void;
}

interface UseConnectionTestResult {
  syncUsernameDraft: string;
  syncPasswordDraft: string;
  setSyncUsernameDraft: (value: string) => void;
  setSyncPasswordDraft: (value: string) => void;
  hasDraftCredentials: boolean;
  syncStatusBadge: SyncStatusBadge;
  isConnectionUpdating: boolean;
  isConnectionDisconnectAction: boolean;
  isSyncing: boolean;
  syncTestResult: SyncActionResult | null;
  setSyncTestResult: Dispatch<SetStateAction<SyncActionResult | null>>;
  clearSyncTestResult: () => void;
  handleConnectionAction: () => Promise<void>;
  performSync: () => Promise<void>;
}

function resolveSyncStatusBadge(args: {
  uploadEnabled: boolean;
  authStatusChecking: boolean;
  authConnectionError: boolean;
  authEnabled: boolean;
  authorized: boolean;
  hasDraftCredentials: boolean;
  t: TFunction;
}): SyncStatusBadge {
  const {
    uploadEnabled,
    authStatusChecking,
    authConnectionError,
    authEnabled,
    authorized,
    hasDraftCredentials,
    t,
  } = args;

  if (!uploadEnabled) {
    return {
      label: t('settings.serverSyncStateLocal'),
      className:
        'border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)]',
    };
  }

  if (authStatusChecking) {
    return {
      label: t('settings.serverSyncStateChecking'),
      className:
        'airqr-status-warning',
    };
  }

  if (authConnectionError) {
    return {
      label: t('settings.serverSyncStateUnavailable'),
      className:
        'airqr-status-danger',
    };
  }

  if (!authEnabled) {
    return {
      label: t('settings.serverSyncStateOpen'),
      className:
        'border-[var(--airqr-control-border)] bg-[var(--airqr-accent-soft)] text-[var(--airqr-accent-text)]',
    };
  }

  if (authorized) {
    return {
      label: t('settings.serverSyncStateConnected'),
      className:
        'airqr-status-success',
    };
  }

  if (hasDraftCredentials) {
    return {
      label: t('settings.serverSyncStateReady'),
      className:
        'border-[var(--airqr-control-border)] bg-[var(--airqr-accent-soft)] text-[var(--airqr-accent-text)]',
    };
  }

  return {
    label: t('settings.serverSyncStateCredentials'),
    className:
      'airqr-status-warning',
  };
}

export function useConnectionTest({
  uploadConfig,
  setUploadConfig,
  syncBaseUrl,
  authEnabled,
  authorized,
  authStatusChecking,
  authConnectionError,
  t,
  showToast,
}: UseConnectionTestArgs): UseConnectionTestResult {
  // Kept in the public hook contract for existing callers. Connection failures
  // are contextual and intentionally render only in the inline result area.
  void showToast;
  const [syncUsernameDraftState, setSyncUsernameDraftState] = useState(uploadConfig.username);
  const [syncPasswordDraftState, setSyncPasswordDraftState] = useState(uploadConfig.password);
  const [isConnectionUpdating, setIsConnectionUpdating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncTestResult, setSyncTestResult] = useState<SyncActionResult | null>(null);
  const previousAuthorizedRef = useRef(authorized);

  useEffect(() => {
    setSyncUsernameDraftState(uploadConfig.username);
  }, [uploadConfig.username]);

  useEffect(() => {
    setSyncPasswordDraftState(uploadConfig.password);
  }, [uploadConfig.password]);

  const clearSyncTestResult = useCallback(() => {
    setSyncTestResult(null);
  }, []);

  const setSyncUsernameDraft = useCallback((value: string) => {
    setSyncUsernameDraftState(value);
    setSyncTestResult(null);
  }, []);

  const setSyncPasswordDraft = useCallback((value: string) => {
    setSyncPasswordDraftState(value);
    setSyncTestResult(null);
  }, []);

  const hasDraftCredentials = Boolean(syncUsernameDraftState && syncPasswordDraftState);
  const hasDraftAuthMaterial = Boolean(uploadConfig.apiKey || hasDraftCredentials);
  const hasStoredAuthSecret = Boolean(uploadConfig.apiKey || uploadConfig.password);
  const isLocalMixedContentDisconnectAction = Boolean(
    syncBaseUrl &&
      isMixedContentBlocked(syncBaseUrl) &&
      hasStoredAuthSecret
  );
  const isConnectionDisconnectAction =
    (authEnabled && authorized && !hasDraftAuthMaterial) ||
    isLocalMixedContentDisconnectAction;

  const draftSyncAuthConfig = useMemo(
    () => ({
      apiKey: uploadConfig.apiKey,
      username: syncUsernameDraftState,
      password: syncPasswordDraftState,
    }),
    [uploadConfig.apiKey, syncUsernameDraftState, syncPasswordDraftState]
  );

  const syncStatusBadge = useMemo(
    () =>
      resolveSyncStatusBadge({
        uploadEnabled: uploadConfig.enabled,
        authStatusChecking,
        authConnectionError,
        authEnabled,
        authorized,
        hasDraftCredentials,
        t,
      }),
    [
      uploadConfig.enabled,
      authStatusChecking,
      authConnectionError,
      authEnabled,
      authorized,
      hasDraftCredentials,
      t,
    ]
  );

  useEffect(() => {
    const wasAuthorized = previousAuthorizedRef.current;
    if (!wasAuthorized && authorized && syncTestResult?.kind === 'sign-out') {
      setSyncTestResult(null);
    }
    previousAuthorizedRef.current = authorized;
  }, [authorized, syncTestResult?.kind]);

  const persistDraftSyncCredentials = useCallback(() => {
    if (
      uploadConfig.username !== syncUsernameDraftState ||
      uploadConfig.password !== syncPasswordDraftState
    ) {
      setUploadConfig({
        username: syncUsernameDraftState,
        password: syncPasswordDraftState,
      });
    }
  }, [
    uploadConfig.username,
    uploadConfig.password,
    syncUsernameDraftState,
    syncPasswordDraftState,
    setUploadConfig,
  ]);

  const resolveValidatedBaseUrl = useCallback(() => {
    if (!syncBaseUrl) {
      setSyncTestResult({
        success: false,
        message: 'Invalid server URL',
        kind: 'error',
      });
      return null;
    }
    return syncBaseUrl;
  }, [syncBaseUrl]);

  const blockMixedContentIfNeeded = useCallback(
    (baseUrl: string) => {
      if (!isMixedContentBlocked(baseUrl)) {
        return false;
      }

      const message = t('errors.connectionMixedContent');
      setSyncTestResult({
        success: false,
        message,
        kind: 'error',
      });
      return true;
    },
    [t]
  );

  const buildDraftSyncHeaders = useCallback(
    (contentType = 'application/json') =>
      buildServerAuthHeaders(draftSyncAuthConfig, contentType),
    [draftSyncAuthConfig]
  );

  const ensureDraftSession = useCallback(async (baseUrl: string) => {
    if (draftSyncAuthConfig.username && draftSyncAuthConfig.password) {
      const loginEndpoint = buildServerEndpoint(baseUrl, 'api/auth/login');
      if (resolveFetchCredentials(loginEndpoint) === 'same-origin') {
        await loginToServerSession(uploadConfig, {
          username: draftSyncAuthConfig.username,
          password: draftSyncAuthConfig.password,
        });
      }
      return true;
    }

    if (authEnabled && !authorized) {
      setSyncTestResult({
        success: false,
        message: t('settings.authStatusRequired'),
        kind: 'error',
      });
      return false;
    }

    return true;
  }, [
    authEnabled,
    authorized,
    draftSyncAuthConfig.password,
    draftSyncAuthConfig.username,
    t,
    uploadConfig,
  ]);

  const getSyncAuthErrorMessage = useCallback(
    (baseUrl: string, error: WireValue) => {
      if (isServerRequestTimeoutError(error)) {
        return t(getConnectionTimeoutTranslationKey(baseUrl));
      }
      if (error instanceof Error && error.message.includes('401')) {
        return t('settings.authInvalidCredentials');
      }
      return t(getConnectionFailureTranslationKey(baseUrl));
    },
    [t]
  );

  const probeHistory = useCallback(
    async (baseUrl: string, config: ScanUploadConfig) => {
      const endpoint = buildServerEndpoint(baseUrl, 'api/history?limit=1');
      const response = await fetchServerWithTimeout(endpoint, {
        method: 'GET',
        headers: buildServerAuthHeaders(
          {
            apiKey: config.apiKey,
            username: syncUsernameDraftState,
            password: syncPasswordDraftState,
          }
        ),
        credentials: resolveFetchCredentials(endpoint),
        cache: 'no-store',
      });

      if (response.ok) {
        const payload = await response.clone().json();
        if (!Array.isArray(payload)) {
          throw new Error('Unexpected sync server response');
        }
      }

      return response;
    },
    [syncPasswordDraftState, syncUsernameDraftState]
  );

  const trySameOriginLocalFallback = useCallback(
    async (failedBaseUrl: string) => {
      const fallbackBaseUrl = resolveSameOriginLocalFallback(failedBaseUrl);
      if (!fallbackBaseUrl) {
        return false;
      }

      const fallbackConfig = {
        ...uploadConfig,
        url: 'same-origin',
      };

      if (syncUsernameDraftState && syncPasswordDraftState) {
        await loginToServerSession(fallbackConfig, {
          username: syncUsernameDraftState,
          password: syncPasswordDraftState,
        });
      }

      const response = await probeHistory(fallbackBaseUrl, fallbackConfig);
      if (!response.ok) {
        return false;
      }

      setUploadConfig({
        url: 'same-origin',
        username: syncUsernameDraftState,
        password: syncPasswordDraftState,
      });
      setSyncTestResult({
        success: true,
        message: t('settings.connectionSuccess'),
        kind: 'connection',
      });
      return true;
    },
    [
      probeHistory,
      setUploadConfig,
      syncPasswordDraftState,
      syncUsernameDraftState,
      t,
      uploadConfig,
    ]
  );

  const handleConnectionAction = useCallback(async () => {
    const baseUrl = resolveValidatedBaseUrl();
    if (!baseUrl) {
      return;
    }

    const isLocalMixedContentDisconnect =
      isMixedContentBlocked(baseUrl) && hasStoredAuthSecret;
    const isAuthorizedCookieDisconnect =
      authEnabled && authorized && !hasDraftAuthMaterial;
    const isDisconnectAction =
      isAuthorizedCookieDisconnect || isLocalMixedContentDisconnect;
    if (!isDisconnectAction && blockMixedContentIfNeeded(baseUrl)) {
      return;
    }

    setIsConnectionUpdating(true);
    setSyncTestResult(null);

    try {
      if (isDisconnectAction) {
        if (!isLocalMixedContentDisconnect) {
          await logoutFromServerSession(uploadConfig);
        }
        setUploadConfig(
          isLocalMixedContentDisconnect
            ? { apiKey: '', username: '', password: '' }
            : { password: '' }
        );
        if (isLocalMixedContentDisconnect) {
          setSyncUsernameDraftState('');
        }
        setSyncPasswordDraftState('');
        setSyncTestResult({
          success: true,
          message: t('settings.signOutSuccess'),
          kind: 'sign-out',
        });
        return;
      }

      const ready = await ensureDraftSession(baseUrl);
      if (!ready) {
        return;
      }

      const response = await probeHistory(baseUrl, uploadConfig);

      if (response.ok) {
        persistDraftSyncCredentials();
        setSyncTestResult({
          success: true,
          message: t('settings.connectionSuccess'),
          kind: 'connection',
        });
      } else if (response.status === 401) {
        setSyncTestResult({
          success: false,
          message: t('settings.authInvalidCredentials'),
          kind: 'error',
        });
      } else {
        setSyncTestResult({
          success: false,
          message: `Server error: ${response.status}`,
          kind: 'error',
        });
      }
    } catch (error) {
      try {
        if (await trySameOriginLocalFallback(baseUrl)) {
          return;
        }
      } catch {
        // Preserve the original direct-connection diagnostic below.
      }
      const message = getSyncAuthErrorMessage(
        baseUrl,
        error instanceof Error ? error : String(error)
      );
      setSyncTestResult({ success: false, message, kind: 'error' });
    } finally {
      setIsConnectionUpdating(false);
    }
  }, [
    authEnabled,
    authorized,
    blockMixedContentIfNeeded,
    ensureDraftSession,
    hasDraftAuthMaterial,
    getSyncAuthErrorMessage,
    hasStoredAuthSecret,
    persistDraftSyncCredentials,
    resolveValidatedBaseUrl,
    setUploadConfig,
    t,
    probeHistory,
    trySameOriginLocalFallback,
    uploadConfig,
  ]);

  const performSync = useCallback(async () => {
    if (!uploadConfig.url) {
      return;
    }

    const baseUrl = resolveValidatedBaseUrl();
    if (!baseUrl) {
      return;
    }

    if (blockMixedContentIfNeeded(baseUrl)) {
      return;
    }

    setIsSyncing(true);
    setSyncTestResult(null);

    try {
      const ready = await ensureDraftSession(baseUrl);
      if (!ready) {
        return;
      }

      const endpoint = buildServerEndpoint(baseUrl, 'api/history');
      const response = await fetchServerWithTimeout(endpoint, {
        method: 'GET',
        headers: buildDraftSyncHeaders(),
        credentials: resolveFetchCredentials(endpoint),
        cache: 'no-store',
      });

      if (response.ok) {
        persistDraftSyncCredentials();
        const data = await response.json();
        const remoteItems = Array.isArray(data) ? data : [];
        const count = remoteItems.length;
        let newItems = 0;
        try {
          const localItems = await loadHistoryFromIndexedDB();
          const localIds = new Set(localItems.map((item) => item.id));
          newItems = remoteItems.filter((item: { id?: string }) => item.id && !localIds.has(item.id)).length;
        } catch {
          // Ignore local history issues and still show remote sync success.
        }
        setSyncTestResult({
          success: true,
          message: t('settings.syncSuccess', {
            uploaded: 0,
            downloaded: count,
            newItems,
          }),
          kind: 'sync',
        });
      } else if (response.status === 401) {
        setSyncTestResult({
          success: false,
          message: t('settings.authInvalidCredentials'),
          kind: 'error',
        });
      } else {
        setSyncTestResult({
          success: false,
          message: `Server error: ${response.status}`,
          kind: 'error',
        });
      }
    } catch (error) {
      setSyncTestResult({
        success: false,
        message: getSyncAuthErrorMessage(
          baseUrl,
          error instanceof Error ? error : String(error)
        ),
        kind: 'error',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [
    blockMixedContentIfNeeded,
    buildDraftSyncHeaders,
    ensureDraftSession,
    getSyncAuthErrorMessage,
    persistDraftSyncCredentials,
    resolveValidatedBaseUrl,
    t,
    uploadConfig.url,
  ]);

  return {
    syncUsernameDraft: syncUsernameDraftState,
    syncPasswordDraft: syncPasswordDraftState,
    setSyncUsernameDraft,
    setSyncPasswordDraft,
    hasDraftCredentials,
    syncStatusBadge,
    isConnectionUpdating,
    isConnectionDisconnectAction,
    isSyncing,
    syncTestResult,
    setSyncTestResult,
    clearSyncTestResult,
    handleConnectionAction,
    performSync,
  };
}
