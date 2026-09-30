import { useEffect, useState } from 'react';

import type { ScanUploadConfig } from '../types';
import {
  fetchServerAuthStatus,
  getCachedServerAuthStatus,
  hasServerCredentials,
  loginToServerSession,
  subscribeServerAuthStatus,
  type ServerAuthStatus,
} from '../services/serverAuth';
import { resolveServerBaseUrl } from '../services/syncUrl';

const OPEN_AUTH_STATUS: ServerAuthStatus = {
  enabled: false,
  authorized: true,
};

export function useServerAuthState(config: ScanUploadConfig) {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [probeState, setProbeState] = useState<{
    requestKey: string | null;
    status: ServerAuthStatus;
    connectionError: boolean;
  } | null>(null);

  useEffect(
    () => subscribeServerAuthStatus(() => setRefreshNonce((value) => value + 1)),
    []
  );

  const baseUrl =
    config.enabled && config.url
      ? (resolveServerBaseUrl(config.url) ?? config.url.trim()) || 'invalid'
      : null;
  const requestKey = baseUrl
    ? [
        baseUrl,
        config.apiKey || '',
        config.username || '',
        config.password || '',
        refreshNonce,
      ].join('::')
    : null;
  const cachedStatus =
    config.enabled && config.url ? getCachedServerAuthStatus(config) : null;
  const resolvedProbe = probeState?.requestKey === requestKey ? probeState : null;
  const status =
    !config.enabled || !config.url
      ? OPEN_AUTH_STATUS
      : cachedStatus ?? resolvedProbe?.status ?? OPEN_AUTH_STATUS;
  const checking = Boolean(
    config.enabled &&
      config.url &&
      !cachedStatus &&
      !resolvedProbe
  );
  const connectionError =
    config.enabled && config.url
      ? resolvedProbe?.connectionError ?? false
      : false;

  useEffect(() => {
    if (!config.enabled || !config.url || !requestKey) {
      return;
    }

    const credentialsPresent = hasServerCredentials(config);
    let cancelled = false;
    void fetchServerAuthStatus(config)
      .then(async (nextStatus) => {
        if (
          nextStatus.enabled &&
          !nextStatus.authorized &&
          credentialsPresent
        ) {
          await loginToServerSession(config);
          return fetchServerAuthStatus(config, { force: true });
        }
        return nextStatus;
      })
      .then((nextStatus) => {
        if (cancelled) {
          return;
        }
        setProbeState({
          requestKey,
          status: nextStatus,
          connectionError: false,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setProbeState({
          requestKey,
          status: OPEN_AUTH_STATUS,
          connectionError: true,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [config, requestKey]);

  const authReady =
    Boolean(config.enabled && config.url) &&
    !checking &&
    !connectionError &&
    (!status.enabled || status.authorized);

  return {
    authEnabled: status.enabled,
    authorized: status.authorized,
    username: status.username ?? null,
    checking,
    connectionError,
    authReady,
  };
}
