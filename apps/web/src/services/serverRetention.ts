/**
 * Read and change how long the sync server keeps history entries.
 */

import { asWireFiniteNumber, asWireObject, isWireNumber, type WireValue } from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import { buildServerAuthHeaders } from './serverAuth';
import { fetchServerWithTimeout } from './serverFetch';
import {
  buildServerEndpoint,
  resolveFetchCredentials,
  resolveServerBaseUrl,
} from './syncUrl';

export const HISTORY_RETENTION_MIN_DAYS = 1;
export const HISTORY_RETENTION_MAX_DAYS = 3650;

export interface HistoryRetention {
  /** Days before an entry is deleted; null means never. */
  historyDays: number | null;
  /** "settings" when saved from the app, "server-default" for the server flag. */
  source: 'settings' | 'server-default';
  defaultHistoryDays: number | null;
}

type RetentionServerConfig = Pick<
  ScanUploadConfig,
  'url' | 'apiKey' | 'username' | 'password'
>;

const settingsEndpoint = (config: RetentionServerConfig): string => {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }
  return buildServerEndpoint(baseUrl, 'api/config/settings');
};

// Older servers do not send `retentionEffective`; treat that as unsupported.
const parseRetention = (body: WireValue): HistoryRetention => {
  const retention = asWireObject(asWireObject(body).retentionEffective);
  const { historyDays } = retention;
  if (historyDays !== null && !isWireNumber(historyDays)) {
    throw new Error('Server did not report its history retention');
  }
  return {
    historyDays,
    source: retention.source === 'settings' ? 'settings' : 'server-default',
    defaultHistoryDays: asWireFiniteNumber(retention.defaultHistoryDays) ?? null,
  };
};

export async function fetchHistoryRetention(
  config: RetentionServerConfig
): Promise<HistoryRetention> {
  const endpoint = settingsEndpoint(config);
  const response = await fetchServerWithTimeout(endpoint, {
    method: 'GET',
    headers: buildServerAuthHeaders(config, 'application/json'),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Settings fetch failed: ${response.status}`);
  }
  const body: WireValue = await response.json();
  return parseRetention(body);
}

export async function saveHistoryRetention(
  config: RetentionServerConfig,
  historyDays: number | null
): Promise<HistoryRetention> {
  const endpoint = settingsEndpoint(config);
  const response = await fetchServerWithTimeout(endpoint, {
    method: 'POST',
    headers: buildServerAuthHeaders(config, 'application/json'),
    credentials: resolveFetchCredentials(endpoint),
    body: JSON.stringify({ retention: { historyDays } }),
  });
  if (!response.ok) {
    throw new Error(`Settings save failed: ${response.status}`);
  }
  const body: WireValue = await response.json();
  return parseRetention(body);
}
